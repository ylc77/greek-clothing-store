import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { invalidateProductsCache } from "@/lib/cache";
import { syncProductVariantActiveFromLegacy } from "@/lib/erp-inventory";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PUT(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin client not configured" }, { status: 500 });

  const body = (await request.json()) as { ids?: string[]; is_active?: boolean };
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const isActive = body.is_active === true;

  if (ids.length === 0) {
    return NextResponse.json({ error: "No product IDs provided" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("products")
    .update({ is_active: isActive })
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let erpSyncWarning: string | undefined;
  let erpSyncErrors: { productId: number; message: string }[] = [];
  try {
    const productIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    const syncResult = await syncProductVariantActiveFromLegacy(productIds);
    erpSyncErrors = syncResult.warnings;
    if (syncResult.warnings.length > 0) {
      erpSyncWarning = "商品上下架已保存，但部分 ERP variant active 同步需要检查。";
    }
  } catch (syncError) {
    erpSyncWarning =
      syncError instanceof Error ? syncError.message : "ERP variant active sync failed.";
  }

  invalidateProductsCache();

  return NextResponse.json({
    ok: true,
    count: ids.length,
    action: isActive ? "activated" : "deactivated",
    erpSyncWarning,
    erpSyncErrors,
  });
}
