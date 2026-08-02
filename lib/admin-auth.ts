import { getSupabaseAdminClient } from "./supabase";
import { isFeatureEnabled } from "./features";
import {
  configuredAdminPasswordRole,
  validateAdminPasswordEnvironment,
  type AdminPasswordConfiguration,
} from "./admin-password-security";
import {
  AbuseProtectionUnavailableError,
  checkSharedAuthLimit,
  recordSharedAuthAttempt,
} from "./abuse-protection";

export type AdminRole = "owner" | "staff" | "inventory" | "readonly";

export type AdminPermission =
  | "products:read"
  | "products:write"
  | "products:delete"
  | "inventory:read"
  | "inventory:write"
  | "pos:read"
  | "pos:checkout"
  | "pos:void"
  | "labels:write"
  | "categories:write"
  | "feed:read"
  | "backup:read"
  | "ai:write"
  | "procurement:read"
  | "procurement:cost"
  | "procurement:write"
  | "online_orders:read"
  | "online_orders:write";

export type AdminAuthContext = {
  role: AdminRole;
  permissions: AdminPermission[];
  authType?: "password" | "account";
  userId?: string;
  email?: string;
  displayName?: string | null;
};

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  owner: [
    "products:read",
    "products:write",
    "products:delete",
    "inventory:read",
    "inventory:write",
    "pos:read",
    "pos:checkout",
    "pos:void",
    "labels:write",
    "categories:write",
    "feed:read",
    "backup:read",
    "ai:write",
    "procurement:read",
    "procurement:cost",
    "procurement:write",
    "online_orders:read",
    "online_orders:write",
  ],
  staff: ["products:read", "inventory:read", "pos:read", "pos:checkout", "feed:read", "online_orders:read", "online_orders:write"],
  inventory: [
    "products:read",
    "inventory:read",
    "inventory:write",
    "labels:write",
    "feed:read",
    "procurement:read",
  ],
  readonly: ["products:read", "inventory:read", "pos:read", "feed:read"],
};

export type AdminAuthenticationFailure =
  | "unauthenticated"
  | "invalid"
  | "forbidden"
  | "feature_disabled"
  | "rate_limited"
  | "unavailable";

export type AdminAuthenticationResult = {
  context: AdminAuthContext | null;
  failure: AdminAuthenticationFailure | null;
  retryAfter?: number;
};

export type AdminAuthorizationDecision =
  | { allowed: true; context: AdminAuthContext }
  | { allowed: false; status: 401 | 403 | 429 | 503; code: string; error: string; retryAfter?: number };

function passwordConfiguration(): AdminPasswordConfiguration {
  return validateAdminPasswordEnvironment(process.env);
}

export function getAdminContextFromPassword(password: string | null | undefined): AdminAuthContext | null {
  const providedPassword = typeof password === "string" ? password : "";
  if (!providedPassword) {
    return null;
  }
  const role = configuredAdminPasswordRole(providedPassword, passwordConfiguration());
  return role ? {
    role,
    permissions: ROLE_PERMISSIONS[role],
    authType: "password",
  } : null;
}

export function adminPasswordIsValid(password: string | null | undefined) {
  return getAdminContextFromPassword(password)?.role === "owner";
}

export function getAdminContextFromRequest(request: Request) {
  return getAdminContextFromPassword(request.headers.get("x-admin-password"));
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function isAdminRole(value: unknown): value is AdminRole {
  return value === "owner" || value === "staff" || value === "inventory" || value === "readonly";
}

async function passwordAuthentication(request: Request): Promise<AdminAuthenticationResult> {
  try {
    const status = await checkSharedAuthLimit(request, "admin-password");
    if (!status.allowed) return { context: null, failure: "rate_limited", retryAfter: status.retryAfter };
    const passwordContext = getAdminContextFromRequest(request);
    const attempt = await recordSharedAuthAttempt(request, "admin-password", Boolean(passwordContext));
    if (!attempt.allowed) return { context: null, failure: "rate_limited", retryAfter: attempt.retryAfter };
    if (!passwordContext) return { context: null, failure: "invalid" };
    if (passwordContext.role !== "owner" && !(await isFeatureEnabled("staff_accounts"))) {
      return { context: null, failure: "feature_disabled" };
    }
    return { context: passwordContext, failure: null };
  } catch (error) {
    if (error instanceof AbuseProtectionUnavailableError || error instanceof Error) {
      return { context: null, failure: "unavailable" };
    }
    return { context: null, failure: "unavailable" };
  }
}

export async function getAdminAuthenticationResult(request: Request): Promise<AdminAuthenticationResult> {
  const password = request.headers.get("x-admin-password");
  if (password) return passwordAuthentication(request);

  const token = getBearerToken(request);
  if (!token) return { context: null, failure: "unauthenticated" };

  const supabase = getSupabaseAdminClient();
  if (!supabase) return { context: null, failure: "unavailable" };

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return { context: null, failure: "invalid" };

  const { data: adminUser, error: adminUserError } = await (supabase as any)
    .from("admin_users")
    .select("id, email, role, display_name, active")
    .eq("id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminUserError) return { context: null, failure: "unavailable" };
  if (!adminUser || !isAdminRole(adminUser.role)) return { context: null, failure: "forbidden" };
  const role = adminUser.role as AdminRole;
  if (role !== "owner" && !(await isFeatureEnabled("staff_accounts"))) {
    return { context: null, failure: "feature_disabled" };
  }

  return {
    context: {
      role,
      permissions: ROLE_PERMISSIONS[role],
      authType: "account",
      userId: user.id,
      email: adminUser.email || user.email || "",
      displayName: adminUser.display_name || null,
    },
    failure: null,
  };
}

export async function getAdminAuthContextFromRequest(request: Request): Promise<AdminAuthContext | null> {
  return (await getAdminAuthenticationResult(request)).context;
}

export async function authorizeAdminRequest(request: Request, permission: AdminPermission): Promise<AdminAuthorizationDecision> {
  const authentication = await getAdminAuthenticationResult(request);
  if (!authentication.context) {
    if (authentication.failure === "rate_limited") {
      return { allowed: false, status: 429, code: "AUTH_RATE_LIMITED", error: "Too many authentication attempts.", retryAfter: authentication.retryAfter };
    }
    if (authentication.failure === "unavailable") {
      return { allowed: false, status: 503, code: "AUTH_SECURITY_UNAVAILABLE", error: "Authentication security controls are unavailable." };
    }
    if (authentication.failure === "feature_disabled") {
      return { allowed: false, status: 403, code: "FEATURE_DISABLED", error: "Employee accounts are disabled for this customer plan." };
    }
    if (authentication.failure === "forbidden") {
      return { allowed: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
    }
    return { allowed: false, status: 401, code: "UNAUTHORIZED", error: "Unauthorized" };
  }
  if (!adminHasPermission(authentication.context, permission)) {
    return { allowed: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  }
  return { allowed: true, context: authentication.context };
}

export function adminHasPermission(context: AdminAuthContext | null, permission: AdminPermission) {
  return Boolean(context?.permissions.includes(permission));
}

export function adminActorFromContext(context: AdminAuthContext) {
  if (context.authType === "account" && context.userId) {
    return `account:${context.role}:${context.userId}`;
  }
  return `${context.authType || "admin"}:${context.role}`;
}

export function adminRequestHasPermission(request: Request, permission: AdminPermission) {
  return adminHasPermission(getAdminContextFromRequest(request), permission);
}

export async function adminRequestHasPermissionAsync(request: Request, permission: AdminPermission) {
  return adminHasPermission(await getAdminAuthContextFromRequest(request), permission);
}

export async function adminRequestIsOwnerAsync(request: Request) {
  return (await getAdminAuthContextFromRequest(request))?.role === "owner";
}

export function getAdminRolePermissions(role: AdminRole) {
  return ROLE_PERMISSIONS[role];
}
