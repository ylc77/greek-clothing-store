import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { getInventoryOverview } from "@/lib/erp-inventory";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseBoolean(value: string | null) {
  if (value === null) return false;
  return value === "1" || value.toLowerCase() === "true";
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "inventory:read"))) return unauthorized();
  if (!(await isFeatureEnabled("inventory"))) return featureDisabledResponse("inventory");

  const url = new URL(request.url);
  try {
    const result = await getInventoryOverview({
      q: url.searchParams.get("q") || undefined,
      size: url.searchParams.get("size") || undefined,
      category: url.searchParams.get("category") || undefined,
      subcategory: url.searchParams.get("subcategory") || undefined,
      zeroStock: parseBoolean(url.searchParams.get("zeroStock")),
      inactive: parseBoolean(url.searchParams.get("inactive")),
      limit: Number(url.searchParams.get("limit")) || undefined,
      offset: Number(url.searchParams.get("offset")) || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load inventory overview.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
