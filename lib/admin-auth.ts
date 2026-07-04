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
  | "settings:write"
  | "feed:read"
  | "backup:read"
  | "ai:write";

export type AdminAuthContext = {
  role: AdminRole;
  permissions: AdminPermission[];
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
    "settings:write",
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

export function adminHasPermission(context: AdminAuthContext | null, permission: AdminPermission) {
  return Boolean(context?.permissions.includes(permission));
}

export function adminRequestHasPermission(request: Request, permission: AdminPermission) {
  return adminHasPermission(getAdminContextFromRequest(request), permission);
}

export function getAdminRolePermissions(role: AdminRole) {
  return ROLE_PERMISSIONS[role];
}
