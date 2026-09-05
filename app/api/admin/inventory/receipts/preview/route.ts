import { NextRequest } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure, adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { InventoryReceiptValidationError, parseInventoryReceiptInput } from "@/lib/inventory-receipt";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const decision = await authorizeAdminRequest(request, "inventory:write");
  if (!decision.allowed) return adminAuthorizationFailure(decision);
  if (!(await isFeatureEnabled("inventory"))) return applyAdminPrivateCache(featureDisabledResponse("inventory"));

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return adminPrivateJson({ error: "Request body is too large.", code: "REQUEST_TOO_LARGE", operationSafeToDiscard: true }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return adminPrivateJson({ error: "Request body is too large.", code: "REQUEST_TOO_LARGE", operationSafeToDiscard: true }, { status: 413 });
  }

  let input;
  try {
    input = parseInventoryReceiptInput(JSON.parse(raw));
  } catch (error) {
    return adminPrivateJson({
      error: error instanceof InventoryReceiptValidationError ? error.message : "Invalid JSON body.",
      code: "INVALID_ARGUMENT",
      operationSafeToDiscard: true,
    }, { status: 400 });
  }
  if (input.items.some(item => item.unitCost !== null) && !decision.context.permissions.includes("procurement:cost")) {
    return adminPrivateJson({ error: "You do not have permission to record purchase costs.", code: "FORBIDDEN", operationSafeToDiscard: true }, { status: 403 });
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) return adminPrivateJson({ error: "Receiving preview is unavailable.", code: "INVENTORY_RECEIPT_RPC_UNAVAILABLE", operationSafeToDiscard: true }, { status: 503 });

  const ids = input.items.map(item => item.variantId);
  const [{ data: variants, error: variantError }, { data: location, error: locationError }] = await Promise.all([
    (supabase as any).from("product_variants")
      .select("id,product_id,variant_sku,barcode,size,color,active,products!inner(is_active)")
      .in("id", ids),
    (supabase as any).from("inventory_locations").select("id").eq("code", "MAIN_STORE").eq("active", true).maybeSingle(),
  ]);
  if (variantError || locationError || !location) {
    return adminPrivateJson({ error: "Receiving preview is unavailable.", code: "INVENTORY_RECEIPT_RPC_UNAVAILABLE", operationSafeToDiscard: true }, { status: 503 });
  }
  if ((variants || []).length !== ids.length) {
    return adminPrivateJson({ error: "One or more selected Variants no longer exist.", code: "VARIANT_NOT_FOUND", operationSafeToDiscard: true }, { status: 409 });
  }
  const inactive = (variants || []).find((variant: any) => variant.active === false || variant.products?.is_active === false);
  if (inactive) return adminPrivateJson({ error: "One or more selected products or Variants are inactive.", code: "VARIANT_INACTIVE", operationSafeToDiscard: true }, { status: 409 });

  const { data: balances, error: balanceError } = await (supabase as any).from("inventory_balances")
    .select("variant_id,quantity_on_hand,quantity_reserved").eq("location_id", location.id).in("variant_id", ids);
  if (balanceError) return adminPrivateJson({ error: "Receiving preview is unavailable.", code: "INVENTORY_RECEIPT_RPC_UNAVAILABLE", operationSafeToDiscard: true }, { status: 503 });
  const byVariant = new Map((variants || []).map((variant: any) => [variant.id, variant]));
  const balanceByVariant = new Map((balances || []).map((balance: any) => [balance.variant_id, balance]));
  const items = input.items.map(item => {
    const variant = byVariant.get(item.variantId) as any;
    const before = Number((balanceByVariant.get(item.variantId) as any)?.quantity_on_hand || 0);
    return {
      variantId: item.variantId,
      variantSku: variant.variant_sku,
      barcode: variant.barcode || null,
      size: variant.size,
      color: variant.color,
      quantityReceived: item.quantity,
      quantityBefore: before,
      quantityAfter: before + item.quantity,
      willGenerateBarcode: !String(variant.barcode || "").trim(),
    };
  });
  return adminPrivateJson({
    ok: true,
    itemCount: items.length,
    totalUnits: input.items.reduce((sum, item) => sum + item.quantity, 0),
    missingBarcodeCount: items.filter(item => item.willGenerateBarcode).length,
    items,
  });
}
