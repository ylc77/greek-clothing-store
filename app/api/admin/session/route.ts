import { NextRequest } from "next/server";
import { getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { adminPrivateJson } from "@/lib/admin-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await getAdminAuthContextFromRequest(request);
  if (!context) {
    return adminPrivateJson({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  return adminPrivateJson({
    ok: true,
    role: context.role,
    permissions: context.permissions,
    authType: context.authType,
    userId: context.userId || null,
    email: context.email || null,
    displayName: context.displayName || null,
  });
}
