import { NextRequest, NextResponse } from "next/server";
import { getAdminAuthContextFromRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await getAdminAuthContextFromRequest(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    role: context.role,
    permissions: context.permissions,
    authType: context.authType,
    userId: context.userId || null,
    email: context.email || null,
    displayName: context.displayName || null,
  });
}
