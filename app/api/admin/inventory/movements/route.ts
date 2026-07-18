import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { getInventoryMovements } from "@/lib/erp-inventory";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "inventory:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("inventory"))) return featureDisabledResponse("inventory");

  const url = new URL(request.url);
  try {
    const result = await getInventoryMovements({
      q: url.searchParams.get("q") || undefined,
      variantId: url.searchParams.get("variantId") || undefined,
      movementType: url.searchParams.get("movementType") || undefined,
      sourceType: url.searchParams.get("sourceType") || undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
      offset: Number(url.searchParams.get("offset")) || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load inventory movements.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
