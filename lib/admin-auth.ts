import { getSupabaseAdminClient } from "./supabase";
import { isFeatureEnabled } from "./features";

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
  | "ai:write";

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
  ],
  staff: ["products:read", "inventory:read", "pos:read", "pos:checkout", "feed:read"],
  inventory: ["products:read", "inventory:read", "inventory:write", "labels:write", "feed:read"],
  readonly: ["products:read", "inventory:read", "pos:read", "feed:read"],
};

const ROLE_PASSWORD_ENV: Record<AdminRole, string> = {
  owner: "ADMIN_PASSWORD",
  staff: "ADMIN_STAFF_PASSWORD",
  inventory: "ADMIN_INVENTORY_PASSWORD",
  readonly: "ADMIN_READONLY_PASSWORD",
};

function cleanPassword(password: string | null | undefined) {
  return typeof password === "string" ? password.trim() : "";
}

export function getAdminContextFromPassword(password: string | null | undefined): AdminAuthContext | null {
  const providedPassword = cleanPassword(password);

  if (!providedPassword) {
    return null;
  }

  for (const role of Object.keys(ROLE_PASSWORD_ENV) as AdminRole[]) {
    const expectedPassword = cleanPassword(process.env[ROLE_PASSWORD_ENV[role]]);
    if (expectedPassword && providedPassword === expectedPassword) {
      return {
        role,
        permissions: ROLE_PERMISSIONS[role],
        authType: "password",
      };
    }
  }

  return null;
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

export async function getAdminAuthContextFromRequest(request: Request): Promise<AdminAuthContext | null> {
  const passwordContext = getAdminContextFromRequest(request);
  if (passwordContext) {
    if (passwordContext.role !== "owner" && !(await isFeatureEnabled("staff_accounts"))) return null;
    return passwordContext;
  }

  const token = getBearerToken(request);
  if (!token) return null;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return null;

  const { data: adminUser, error: adminUserError } = await (supabase as any)
    .from("admin_users")
    .select("id, email, role, display_name, active")
    .eq("id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminUserError || !adminUser || !isAdminRole(adminUser.role)) return null;
  const role = adminUser.role as AdminRole;
  if (role !== "owner" && !(await isFeatureEnabled("staff_accounts"))) return null;

  return {
    role,
    permissions: ROLE_PERMISSIONS[role],
    authType: "account",
    userId: user.id,
    email: adminUser.email || user.email || "",
    displayName: adminUser.display_name || null,
  };
}

export function adminHasPermission(context: AdminAuthContext | null, permission: AdminPermission) {
  return Boolean(context?.permissions.includes(permission));
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
