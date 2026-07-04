import { NextRequest, NextResponse } from "next/server";
import { getAdminContextFromRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = getAdminContextFromRequest(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    role: context.role,
    permissions: context.permissions,
  });
}
