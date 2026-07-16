import { NextRequest, NextResponse } from "next/server";
import {
  adminActorFromContext,
  authorizeAdminRequest,
} from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

const MAX_BODY_BYTES = 8 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QuickSellBody = {
  sku?: unknown;
  size?: unknown;
  variantId?: unknown;
  variantSku?: unknown;
  barcode?: unknown;
  quantity?: unknown;
  autoDeactivate?: unknown;
  clientRequestId?: unknown;
};

type VariantRow = {
  id: string;
  product_id: number | string;
  variant_sku: string;
  barcode: string | null;
  size: string | null;
  active: boolean;
};

function errorResponse(
  error: string,
  status: number,
  code: string,
  operationSafeToDiscard: boolean,
) {
  return NextResponse.json({ error, code, operationSafeToDiscard }, { status });
}

function clean(value: unknown, max = 128) {
  if (typeof value !== "string") return "";
  const result = value.trim();
  return result.length <= max ? result : "";
}

function normalizedSize(value: unknown) {
  return clean(value, 64).toUpperCase();
}

async function readBody(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { response: errorResponse("Request body is too large.", 413, "REQUEST_TOO_LARGE", true) };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { response: errorResponse("Request body is too large.", 413, "REQUEST_TOO_LARGE", true) };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
    return { payload: value as QuickSellBody };
  } catch {
    return { response: errorResponse("Invalid JSON body.", 400, "INVALID_ARGUMENT", true) };
  }
}

function rpcFailure(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message || "");
  const known: Array<[string, number, string, string, boolean]> = [
    ["INVENTORY_INVALID_ARGUMENT", 400, "INVALID_ARGUMENT", "Quick Sell parameters are invalid.", true],
    ["INVENTORY_OPERATION_CONFLICT", 409, "INVENTORY_OPERATION_CONFLICT", "This operation ID was already used with different parameters.", false],
    ["INVENTORY_NOT_FOUND", 404, "INVENTORY_NOT_FOUND", "The requested product inventory was not found.", true],
    ["INVENTORY_INACTIVE", 409, "INVENTORY_INACTIVE", "The product or variant is inactive.", true],
    ["INVENTORY_INSUFFICIENT_AVAILABLE", 409, "INVENTORY_INSUFFICIENT_AVAILABLE", "Available inventory is insufficient.", true],
    ["INVENTORY_RESERVED_CONFLICT", 409, "INVENTORY_RESERVED_CONFLICT", "Reserved inventory cannot be sold.", true],
    ["INVENTORY_INVARIANT", 409, "INVENTORY_RECONCILIATION_REQUIRED", "Inventory data requires manual reconciliation.", false],
  ];
  for (const [marker, status, code, publicMessage, safe] of known) {
    if (message.includes(marker)) return errorResponse(publicMessage, status, code, safe);
  }
  return errorResponse("Transactional inventory RPC is unavailable.", 503, "INVENTORY_RPC_UNAVAILABLE", false);
}

async function loadVariant(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  payload: QuickSellBody,
) {
  const variantId = clean(payload.variantId, 64);
  const variantSku = clean(payload.variantSku);
  const barcode = clean(payload.barcode);
  const sku = clean(payload.sku);
  const size = normalizedSize(payload.size);
  const select = "id, product_id, variant_sku, barcode, size, active";

  if (variantId) {
    if (!UUID_PATTERN.test(variantId)) return { response: errorResponse("variantId must be a UUID.", 400, "INVALID_ARGUMENT", true) };
    const { data, error } = await (supabase as any).from("product_variants").select(select).eq("id", variantId).maybeSingle();
    if (error) return { response: errorResponse("Inventory lookup is unavailable.", 503, "INVENTORY_RPC_UNAVAILABLE", false) };
    return data ? { variant: data as VariantRow } : { response: errorResponse("Variant was not found.", 404, "INVENTORY_NOT_FOUND", true) };
  }
  if (variantSku || barcode) {
    let query = (supabase as any).from("product_variants").select(select);
    query = variantSku ? query.eq("variant_sku", variantSku) : query.eq("barcode", barcode);
    const { data, error } = await query.maybeSingle();
    if (error) return { response: errorResponse("Inventory lookup is unavailable.", 503, "INVENTORY_RPC_UNAVAILABLE", false) };
    return data ? { variant: data as VariantRow } : { response: errorResponse("Variant was not found.", 404, "INVENTORY_NOT_FOUND", true) };
  }
  if (!sku) return { response: errorResponse("sku, variantId, variantSku, or barcode is required.", 400, "INVALID_ARGUMENT", true) };

  const { data: product, error: productError } = await (supabase as any)
    .from("products").select("id").eq("sku", sku).maybeSingle();
  if (productError) return { response: errorResponse("Inventory lookup is unavailable.", 503, "INVENTORY_RPC_UNAVAILABLE", false) };
  if (!product) return { response: errorResponse("Product was not found.", 404, "INVENTORY_NOT_FOUND", true) };
  const { data: variants, error: variantsError } = await (supabase as any)
    .from("product_variants").select(select).eq("product_id", product.id).order("sort_order");
  if (variantsError) return { response: errorResponse("Inventory lookup is unavailable.", 503, "INVENTORY_RPC_UNAVAILABLE", false) };
  const rows = (variants || []) as VariantRow[];
  if (size) {
    const matching = rows.filter((variant) => normalizedSize(variant.size || "ONE SIZE") === size);
    if (matching.length !== 1) return { response: errorResponse("The selected size does not identify one Variant.", 400, "INVALID_ARGUMENT", true) };
    return { variant: matching[0] };
  }
  if (rows.length !== 1) {
    return { response: errorResponse("A size or Variant is required for multi-size products.", 400, "INVALID_ARGUMENT", true) };
  }
  return { variant: rows[0] };
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "inventory:write");
  if (!authorization.allowed) {
    return errorResponse(authorization.error, authorization.status, authorization.code, true);
  }
  const authContext = authorization.context;
  if (authContext.role !== "owner") return errorResponse("Forbidden", 403, "FORBIDDEN", true);
  if (!(await isFeatureEnabledUncached("quick_sell"))) return featureDisabledResponse("quick_sell");

  const parsed = await readBody(request);
  if (parsed.response) return parsed.response;
  const payload = parsed.payload!;
  const quantity = Number(payload.quantity ?? 1);
  const clientRequestId = clean(payload.clientRequestId);
  const autoDeactivate = payload.autoDeactivate !== false;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000) {
    return errorResponse("quantity must be an integer between 1 and 1000.", 400, "INVALID_ARGUMENT", true);
  }
  if (!clientRequestId) {
    return errorResponse("clientRequestId must contain 1 to 128 characters.", 400, "INVALID_ARGUMENT", true);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return errorResponse("Admin Supabase is not configured.", 503, "INVENTORY_RPC_UNAVAILABLE", false);

  try {
    const resolved = await loadVariant(supabase, payload);
    if (resolved.response) return resolved.response;
    const variant = resolved.variant!;
    const { data, error } = await (supabase as any).rpc("inventory_apply_rpc", {
      p_client_request_id: clientRequestId,
      p_variant_id: variant.id,
      p_mode: "adjust_by",
      p_quantity: 0 - quantity,
      p_operation_type: "quick_sell",
      p_reason: "Quick sell inventory deduction",
      p_created_by: adminActorFromContext(authContext),
      p_auto_deactivate: autoDeactivate,
    });
    if (error) return rpcFailure(error);
    invalidateProductsCache(typeof data?.productSku === "string" ? data.productSku : null);
    return NextResponse.json({
      ...data,
      sold: quantity,
      idempotencyKey: data?.operationId,
    });
  } catch (error) {
    return rpcFailure(error);
  }
}
