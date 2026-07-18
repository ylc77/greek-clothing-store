import { NextRequest } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { shapeInventoryOverviewForRole } from "@/lib/admin-data-boundary";
import { adminAuthorizationFailure, adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";
import { getInventoryOverview } from "@/lib/erp-inventory";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

function parseBoolean(value: string | null) {
  if (value === null) return false;
  return value === "1" || value.toLowerCase() === "true";
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "inventory:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  const authContext = authorization.context;
  if (!(await isFeatureEnabled("inventory"))) {
    return applyAdminPrivateCache(featureDisabledResponse("inventory"));
  }

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

    return adminPrivateJson(shapeInventoryOverviewForRole(result, authContext.role));
  } catch (error) {
    console.error("[inventory] failed to load overview", {
      code: String((error as { code?: unknown } | null)?.code || "INVENTORY_DATA_UNAVAILABLE"),
    });
    return adminPrivateJson(
      { error: "Inventory data is temporarily unavailable.", code: "INVENTORY_DATA_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
