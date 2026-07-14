import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { parseVariantProcurement, productForForm, validateProductPayload } from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
import { syncProductInventoryFromLegacy } from "@/lib/erp-inventory";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json(
    { error: "Admin Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD." },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "products:read"))) {
    return unauthorized();
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const { data, count, error } = await supabase
    .from("products")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const productRows = (data || []) as Product[];
  const productIds = productRows.map((product) => Number(product.id)).filter(Number.isFinite);
  const procurementByProduct = new Map<number, Record<string, unknown>>();
  if (productIds.length > 0) {
    const { data: variants, error: variantsError } = await (supabase as any)
      .from("product_variants")
      .select("product_id, size, supplier_sku, cost_price, reorder_level")
      .in("product_id", productIds);
    if (variantsError) return NextResponse.json({ error: variantsError.message }, { status: 500 });
    for (const variant of variants || []) {
      const productId = Number(variant.product_id);
      const size = String(variant.size || "ONE SIZE").trim().toUpperCase();
      const current = procurementByProduct.get(productId) || {};
      current[size] = {
        supplier_sku: String(variant.supplier_sku || ""),
        cost_price: variant.cost_price === null ? null : Number(variant.cost_price),
        reorder_level: variant.reorder_level === null ? null : Number(variant.reorder_level),
      };
      procurementByProduct.set(productId, current);
    }
  }

  return NextResponse.json({
    products: productRows.map((product) => ({
      ...productForForm(product),
      variant_procurement: procurementByProduct.get(Number(product.id)) || {},
    })),
    total: count || 0,
    limit,
    offset,
  });
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) {
    return unauthorized();
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const payload = await request.json();
  const { errors, mutation } = validateProductPayload(payload);
  const variantProcurement = parseVariantProcurement(payload.variant_procurement);

  if (!mutation) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("products")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(mutation as any)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let erpSyncWarning: string | undefined;
  try {
    const productId = Number((data as Product).id);
    if (!Number.isFinite(productId)) {
      throw new Error("Invalid product ID for ERP inventory sync.");
    }

    await syncProductInventoryFromLegacy({
      productId,
      reason: "新增商品初始化库存",
      sourceType: "admin_create",
      sourceId: productId,
      movementType: "manual_adjustment",
      idempotencyKey: `admin_create:${productId}:${Date.now()}`,
      createdBy: "admin",
      variantProcurement,
    });
  } catch (syncError) {
    erpSyncWarning =
      syncError instanceof Error ? syncError.message : "ERP inventory sync failed.";
  }

  invalidateProductsCache((data as Product).sku);

  return NextResponse.json(
    { product: productForForm(data as Product), erpSyncWarning },
    { status: 201 },
  );
}
