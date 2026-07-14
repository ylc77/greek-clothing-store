import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { parseVariantProcurement, productForForm, validateProductPayload } from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
import {
  hasInventoryMovementsForProduct,
  syncProductInventoryFromLegacy,
  syncProductVariantActiveFromLegacy,
} from "@/lib/erp-inventory";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

type ProductRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json(
    { error: "Admin Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD." },
    { status: 500 }
  );
}

export async function PUT(request: NextRequest, context: ProductRouteContext) {
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) {
    return unauthorized();
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const { id } = await context.params;
  const payload = await request.json();
  const { errors, mutation } = validateProductPayload(payload);
  const variantProcurement = parseVariantProcurement(payload.variant_procurement);

  if (!mutation) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const { data: existingProduct, error: existingProductError } = await supabase
    .from("products")
    .select("id, sku")
    .eq("id", id)
    .maybeSingle();

  if (existingProductError) {
    return NextResponse.json({ error: existingProductError.message }, { status: 500 });
  }

  if (!existingProduct) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const currentSku = typeof existingProduct.sku === "string" ? existingProduct.sku.trim() : "";
  const nextSku = typeof mutation.sku === "string" ? mutation.sku.trim() : "";
  if (nextSku && currentSku && nextSku !== currentSku) {
    const productId = Number(existingProduct.id);
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    try {
      const hasMovements = await hasInventoryMovementsForProduct(productId);
      if (hasMovements) {
        return NextResponse.json(
          { error: "该商品已有库存记录，不能修改 SKU。请新建商品或联系管理员处理。" },
          { status: 409 },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check inventory history";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from("products")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(mutation as any)
    .eq("id", id)
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
      reason: "后台编辑商品库存",
      sourceType: "admin_edit",
      sourceId: productId,
      movementType: "correction",
      idempotencyKey: `admin_edit:${productId}:${Date.now()}`,
      createdBy: "admin",
      variantProcurement,
    });
  } catch (syncError) {
    erpSyncWarning =
      syncError instanceof Error ? syncError.message : "ERP inventory sync failed.";
  }

  invalidateProductsCache((data as Product).sku);

  return NextResponse.json({ product: productForForm(data as Product), erpSyncWarning });
}

export async function DELETE(request: NextRequest, context: ProductRouteContext) {
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) {
    return unauthorized();
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const { id } = await context.params;
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("sku, image_url, image_urls")
    .eq("id", id)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }

  // Soft delete: set is_active=false, keep storage images
  const { error } = await supabase
    .from("products")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ is_active: false } as any)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let erpSyncWarning: string | undefined;
  let erpSyncErrors: { productId: number; message: string }[] = [];
  try {
    const productId = Number(id);
    if (!Number.isFinite(productId)) {
      throw new Error("Invalid product ID for ERP variant active sync.");
    }
    const syncResult = await syncProductVariantActiveFromLegacy([productId]);
    erpSyncErrors = syncResult.warnings;
    if (syncResult.warnings.length > 0) {
      erpSyncWarning = "商品已下架，但 ERP variant active 同步需要检查。";
    }
  } catch (syncError) {
    erpSyncWarning =
      syncError instanceof Error ? syncError.message : "ERP variant active sync failed.";
  }

  invalidateProductsCache(product?.sku as string | undefined);

  return NextResponse.json({ ok: true, erpSyncWarning, erpSyncErrors });
}
