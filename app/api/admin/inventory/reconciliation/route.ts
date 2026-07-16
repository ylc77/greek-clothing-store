import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { getInventoryReconciliation } from "@/lib/erp-inventory";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "inventory:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("inventory"))) return featureDisabledResponse("inventory");

  try {
    const result = await getInventoryReconciliation();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load inventory reconciliation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
