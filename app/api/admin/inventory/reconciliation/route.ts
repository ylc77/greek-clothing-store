import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermission } from "@/lib/admin-auth";
import { getInventoryReconciliation } from "@/lib/erp-inventory";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!adminRequestHasPermission(request, "inventory:read")) return unauthorized();

  try {
    const result = await getInventoryReconciliation();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load inventory reconciliation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
