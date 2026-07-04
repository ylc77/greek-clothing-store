import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermission } from "@/lib/admin-auth";
import { getInventoryMovements } from "@/lib/erp-inventory";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!adminRequestHasPermission(request, "inventory:read")) return unauthorized();

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
