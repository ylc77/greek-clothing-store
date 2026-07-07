import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { getInventoryReconciliation } from "@/lib/erp-inventory";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "inventory:read"))) return unauthorized();
  if (!(await isFeatureEnabled("inventory"))) return featureDisabledResponse("inventory");

  try {
    const result = await getInventoryReconciliation();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load inventory reconciliation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
