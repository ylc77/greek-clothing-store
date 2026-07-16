import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { productForForm, validateProductPayload } from "@/lib/admin-products";
import type { Product } from "@/lib/types";
import { adminPrivateJson } from "@/lib/admin-response";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
const MAX_VARIANTS = 500;
const MAX_VARIANT_QUANTITY = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

export type ProductVariantMutation = {
  id?: string;
  variant_sku: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  expected_on_hand: number;
  price: number | null;
  cost_price: number | null;
  supplier_id: string | null;
  supplier_sku: string;
  reorder_level: number | null;
  active: boolean;
  sort_order: number;
};

export type ParsedProductMutation = {
  clientRequestId: string;
  metadata: JsonObject;
  variants: ProductVariantMutation[] | null;
  expectedMetadataVersion: number | null;
  expectedStructureVersion: number | null;
};

export function productErrorResponse(
  error: string,
  status: number,
  code: string,
  operationSafeToDiscard: boolean,
) {
  return adminPrivateJson({ error, code, operationSafeToDiscard }, { status });
}

export async function readProductRequestBody(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { response: productErrorResponse("Request body is too large.", 413, "REQUEST_TOO_LARGE", true) };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { response: productErrorResponse("Request body is too large.", 413, "REQUEST_TOO_LARGE", true) };
  }

  try {
    const payload = JSON.parse(raw) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Expected an object");
    }
    return { payload: payload as JsonObject };
  } catch {
    return { response: productErrorResponse("Invalid JSON body.", 400, "INVALID_ARGUMENT", true) };
  }
}

function optionalInteger(value: unknown, minimum = 0) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : Number.NaN;
}

function optionalMoney(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableUuid(value: unknown) {
  const normalized = cleanString(value);
  if (!normalized) return null;
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeVariant(raw: unknown, index: number) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `variants[${index}] must be an object` };
  }

  const value = raw as JsonObject;
  const id = cleanString(value.id);
  const variantSku = cleanString(value.variant_sku);
  const barcode = cleanString(value.barcode);
  const size = cleanString(value.size).toUpperCase() || "ONE SIZE";
  const color = cleanString(value.color);
  const quantity = optionalInteger(value.quantity, 0);
  const expectedOnHand = value.expected_on_hand === undefined
    ? quantity
    : optionalInteger(value.expected_on_hand, 0);
  const price = optionalMoney(value.price);
  const costPrice = optionalMoney(value.cost_price);
  const supplierId = nullableUuid(value.supplier_id);
  const reorderLevel = optionalInteger(value.reorder_level, 0);
  const sortOrder = value.sort_order === undefined ? index : optionalInteger(value.sort_order, 0);

  if (id && !UUID_PATTERN.test(id)) return { error: `variants[${index}].id must be a UUID` };
  if (!variantSku || variantSku.length > 240) {
    return { error: `variants[${index}].variant_sku must contain 1 to 240 characters` };
  }
  if (!size || size.length > 120) return { error: `variants[${index}].size is invalid` };
  if (!Number.isInteger(quantity) || Number(quantity) > MAX_VARIANT_QUANTITY) {
    return { error: `variants[${index}].quantity must be an integer between 0 and ${MAX_VARIANT_QUANTITY}` };
  }
  if (!Number.isInteger(expectedOnHand) || Number(expectedOnHand) > MAX_VARIANT_QUANTITY) {
    return { error: `variants[${index}].expected_on_hand must be an integer between 0 and ${MAX_VARIANT_QUANTITY}` };
  }
  if (Number.isNaN(price)) return { error: `variants[${index}].price must be non-negative` };
  if (Number.isNaN(costPrice)) return { error: `variants[${index}].cost_price must be non-negative` };
  if (supplierId === undefined) return { error: `variants[${index}].supplier_id must be a UUID` };
  if (Number.isNaN(reorderLevel)) {
    return { error: `variants[${index}].reorder_level must be a non-negative integer` };
  }
  if (!Number.isInteger(sortOrder)) return { error: `variants[${index}].sort_order must be a non-negative integer` };

  const normalizedQuantity = Number(quantity);
  const normalizedExpectedOnHand = Number(expectedOnHand);
  const normalizedSortOrder = Number(sortOrder);

  return {
    variant: {
      ...(id ? { id } : {}),
      variant_sku: variantSku,
      barcode,
      size,
      color,
      quantity: normalizedQuantity,
      expected_on_hand: normalizedExpectedOnHand,
      price,
      cost_price: costPrice,
      supplier_id: supplierId,
      supplier_sku: cleanString(value.supplier_sku),
      reorder_level: reorderLevel,
      active: value.active !== false,
      sort_order: normalizedSortOrder,
    } satisfies ProductVariantMutation,
  };
}

function parseVariants(value: unknown, required: boolean) {
  if (value === undefined && !required) return { variants: null as ProductVariantMutation[] | null };
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VARIANTS) {
    return { error: `variants must contain 1 to ${MAX_VARIANTS} rows` };
  }

  const variants: ProductVariantMutation[] = [];
  const ids = new Set<string>();
  const variantSkus = new Set<string>();
  const barcodeValues = new Set<string>();
  const catalogKeys = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const normalized = normalizeVariant(value[index], index);
    if (normalized.error || !normalized.variant) return { error: normalized.error || "Invalid variant" };
    const variant = normalized.variant;
    const catalogKey = `${variant.size}\u0000${variant.color}`;
    if (variant.id && ids.has(variant.id)) return { error: "Duplicate Variant ID" };
    if (variantSkus.has(variant.variant_sku)) return { error: "Duplicate Variant SKU" };
    if (variant.barcode && barcodeValues.has(variant.barcode)) return { error: "Duplicate Variant barcode" };
    if (catalogKeys.has(catalogKey)) return { error: "Duplicate size and color Variant" };
    if (variant.id) ids.add(variant.id);
    variantSkus.add(variant.variant_sku);
    if (variant.barcode) barcodeValues.add(variant.barcode);
    catalogKeys.add(catalogKey);
    variants.push(variant);
  }

  return { variants };
}

const PASSTHROUGH_TEXT_FIELDS = [
  "additional_image_urls",
  "fit",
  "season",
  "availability",
  "category_path_en",
  "category_path_gr",
] as const;

function buildMetadata(payload: JsonObject) {
  const { errors, mutation } = validateProductPayload(payload);
  if (!mutation) return { error: errors.join("; ") || "Invalid product" };

  const { stock: _stock, sizes: _sizes, size_stock: _sizeStock, ...metadata } = mutation;
  const result: JsonObject = { ...metadata };
  if (cleanString(payload.sku).length > 200) return { error: "sku must contain at most 200 characters" };
  const supplierId = nullableUuid(payload.supplier_id);
  if (supplierId === undefined) return { error: "supplier_id must be a UUID or null" };
  result.supplier_id = supplierId;
  for (const field of PASSTHROUGH_TEXT_FIELDS) {
    if (field in payload) result[field] = cleanString(payload[field]);
  }
  for (const field of ["image_width", "image_height"] as const) {
    if (!(field in payload)) continue;
    const parsed = optionalInteger(payload[field], 1);
    if (Number.isNaN(parsed)) return { error: `${field} must be a positive integer or null` };
    result[field] = parsed;
  }
  return { metadata: result };
}

const UPDATE_TEXT_FIELDS = [
  "sku",
  "name_cn",
  "name_gr",
  "name_en",
  "description_cn",
  "description_gr",
  "description_en",
  "category",
  "subcategory",
  "image_url",
  "brand",
  "supplier_style_code",
  "barcode",
  "ean",
  "color",
  "additional_image_urls",
  "skroutz_url",
  "material",
  "fiber_composition_gr",
  "fiber_composition_en",
  "care_instructions_gr",
  "care_instructions_en",
  "country_of_origin",
  "manufacturer_name",
  "manufacturer_contact",
  "eu_responsible_person",
  "product_safety_notes_gr",
  "product_safety_notes_en",
  "fit",
  "season",
  "mpn",
  "availability",
  "fit_type",
  "category_path_en",
  "category_path_gr",
] as const;

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") return value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  return null;
}

function buildUpdateMetadata(payload: JsonObject) {
  const metadata: JsonObject = {};
  for (const field of UPDATE_TEXT_FIELDS) {
    if (field in payload) metadata[field] = cleanString(payload[field]);
  }

  if ("price" in payload) {
    const value = optionalMoney(payload.price);
    if (value === null || Number.isNaN(value)) return { error: "price must be a non-negative number" };
    metadata.price = value;
  }
  if ("vat" in payload) {
    const value = optionalMoney(payload.vat);
    if (value === null || Number.isNaN(value)) return { error: "vat must be a non-negative number" };
    metadata.vat = value;
  }
  for (const field of ["image_width", "image_height"] as const) {
    if (!(field in payload)) continue;
    const value = optionalInteger(payload[field], 1);
    if (Number.isNaN(value)) return { error: `${field} must be a positive integer or null` };
    metadata[field] = value;
  }
  if ("supplier_id" in payload) {
    const value = nullableUuid(payload.supplier_id);
    if (value === undefined) return { error: "supplier_id must be a UUID or null" };
    metadata.supplier_id = value;
  }
  if ("size_system" in payload) {
    const value = cleanString(payload.size_system);
    const allowed = new Set(["letter", "eu_women_numeric", "eu_men_numeric", "eu_shoes", "one_size", "custom"]);
    if (value && !allowed.has(value)) return { error: "size_system is invalid" };
    metadata.size_system = value || null;
  }
  for (const field of ["image_urls", "style_tags", "ai_keywords"] as const) {
    if (!(field in payload)) continue;
    const value = stringArray(payload[field]);
    if (!value) return { error: `${field} must be an array or delimited string` };
    metadata[field] = value;
  }
  if ("size_chart" in payload) {
    let value = payload.size_chart;
    if (typeof value === "string") {
      try {
        value = value.trim() ? JSON.parse(value) : {};
      } catch {
        return { error: "size_chart must be valid JSON" };
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "size_chart must be an object" };
    metadata.size_chart = value;
  }
  for (const field of ["is_active", "material_verified"] as const) {
    if (!(field in payload)) continue;
    if (typeof payload[field] !== "boolean") return { error: `${field} must be boolean` };
    metadata[field] = payload[field];
  }

  if (Object.keys(metadata).length === 0) return { error: "No product metadata fields were provided" };
  if ("sku" in metadata && !metadata.sku) return { error: "sku cannot be empty" };
  if ("category" in metadata && !metadata.category) return { error: "category cannot be empty" };
  return { metadata };
}

export function parseCreateProductMutation(payload: JsonObject) {
  const clientRequestId = cleanString(payload.clientRequestId);
  if (!clientRequestId || clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return { error: "clientRequestId must contain 1 to 128 characters" };
  }
  const metadataResult = buildMetadata(payload);
  if (!metadataResult.metadata) return { error: metadataResult.error || "Invalid product" };
  const variantsResult = parseVariants(payload.variants, true);
  if (!variantsResult.variants) return { error: variantsResult.error || "Invalid variants" };
  return {
    mutation: {
      clientRequestId,
      metadata: metadataResult.metadata,
      variants: variantsResult.variants,
      expectedMetadataVersion: null,
      expectedStructureVersion: null,
    } satisfies ParsedProductMutation,
  };
}

export function parseUpdateProductMutation(payload: JsonObject) {
  const clientRequestId = cleanString(payload.clientRequestId);
  const expectedMetadataVersion = optionalInteger(payload.expectedMetadataVersion, 1);
  const expectedStructureVersion = optionalInteger(payload.expectedStructureVersion, 1);
  if (!clientRequestId || clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return { error: "clientRequestId must contain 1 to 128 characters" };
  }
  if (!Number.isInteger(expectedMetadataVersion) || !Number.isInteger(expectedStructureVersion)) {
    return { error: "expectedMetadataVersion and expectedStructureVersion must be positive integers" };
  }
  const metadataResult = buildUpdateMetadata(payload);
  if (!metadataResult.metadata) return { error: metadataResult.error || "Invalid product" };
  const variantsResult = parseVariants(payload.variants, false);
  if (variantsResult.error) return { error: variantsResult.error };
  return {
    mutation: {
      clientRequestId,
      metadata: metadataResult.metadata,
      variants: variantsResult.variants ?? null,
      expectedMetadataVersion,
      expectedStructureVersion,
    } satisfies ParsedProductMutation,
  };
}

export function parseProductArchiveMutation(payload: JsonObject) {
  const clientRequestId = cleanString(payload.clientRequestId);
  const expectedMetadataVersion = optionalInteger(payload.expectedMetadataVersion, 1);
  const expectedStructureVersion = optionalInteger(payload.expectedStructureVersion, 1);
  if (!clientRequestId || clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return { error: "clientRequestId must contain 1 to 128 characters" };
  }
  if (!Number.isInteger(expectedMetadataVersion) || !Number.isInteger(expectedStructureVersion)) {
    return { error: "expectedMetadataVersion and expectedStructureVersion must be positive integers" };
  }
  return {
    mutation: {
      clientRequestId,
      metadata: { is_active: false },
      variants: null,
      expectedMetadataVersion,
      expectedStructureVersion,
    } satisfies ParsedProductMutation,
  };
}

function rpcMessage(error: unknown) {
  return String((error as { message?: unknown; details?: unknown; hint?: unknown } | null)?.message || "")
    + " "
    + String((error as { details?: unknown } | null)?.details || "")
    + " "
    + String((error as { hint?: unknown } | null)?.hint || "");
}

export function productRpcFailure(error: unknown) {
  const message = rpcMessage(error);
  const known: Array<[string, number, string, string, boolean]> = [
    ["PRODUCT_OPERATION_CONFLICT", 409, "PRODUCT_OPERATION_CONFLICT", "This operation ID was already used with different product data.", false],
    ["PRODUCT_VERSION_CONFLICT", 409, "PRODUCT_VERSION_CONFLICT", "The product changed after this form was opened. Reload and try again.", true],
    ["PRODUCT_STOCK_CONFLICT", 409, "PRODUCT_STOCK_CONFLICT", "Inventory changed after this form was opened. Reload and reconcile the requested quantities.", true],
    ["PRODUCT_VARIANT_DEACTIVATION_BLOCKED", 409, "PRODUCT_VARIANT_DEACTIVATION_BLOCKED", "A Variant with stock or reservations cannot be disabled.", true],
    ["PRODUCT_VARIANT_SKU_IMMUTABLE", 409, "PRODUCT_VARIANT_SKU_IMMUTABLE", "Variant SKU cannot be changed after creation.", true],
    ["PRODUCT_VARIANT_SKU_CONFLICT", 409, "PRODUCT_VARIANT_CONFLICT", "Variant SKU belongs to another product.", true],
    ["PRODUCT_SKU_IMMUTABLE", 409, "PRODUCT_SKU_IMMUTABLE", "Product SKU cannot be changed after creation.", true],
    ["PRODUCT_SKU_CONFLICT", 409, "PRODUCT_SKU_CONFLICT", "Product SKU already exists.", true],
    ["PRODUCT_VARIANT_CONFLICT", 409, "PRODUCT_VARIANT_CONFLICT", "Variant SKU, barcode, size, or supplier SKU conflicts with another Variant.", true],
    ["PRODUCT_NOT_FOUND", 404, "PRODUCT_NOT_FOUND", "Product not found.", true],
    ["PRODUCT_VARIANTS_REQUIRED", 400, "PRODUCT_VARIANTS_REQUIRED", "Changing the base price requires the current authoritative Variant list.", true],
    ["PRODUCT_INVALID_ARGUMENT", 400, "INVALID_ARGUMENT", "Product operation parameters are invalid.", true],
    ["PRODUCT_RECONCILIATION_REQUIRED", 409, "PRODUCT_RECONCILIATION_REQUIRED", "Product inventory data requires manual reconciliation.", false],
    ["PRODUCT_RUNTIME_UNAVAILABLE", 503, "PRODUCT_RPC_UNAVAILABLE", "Transactional product prerequisites are unavailable.", false],
  ];
  for (const [marker, status, code, publicMessage, safe] of known) {
    if (message.includes(marker)) return productErrorResponse(publicMessage, status, code, safe);
  }

  // A unique violation should normally be translated by the RPC. Keep this
  // final defensive mapping specific and do not expose database details.
  if (message.includes("23505") || message.includes("duplicate key value")) {
    return productErrorResponse("Product or Variant identity already exists.", 409, "PRODUCT_VARIANT_CONFLICT", true);
  }
  return productErrorResponse(
    "Transactional product RPC is unavailable.",
    503,
    "PRODUCT_RPC_UNAVAILABLE",
    false,
  );
}

function resultObject(value: unknown): JsonObject {
  if (Array.isArray(value)) return resultObject(value[0]);
  return value && typeof value === "object" ? value as JsonObject : {};
}

export function productIdFromRpcResult(value: unknown) {
  const result = resultObject(value);
  const nestedProduct = result.product && typeof result.product === "object"
    ? result.product as JsonObject
    : null;
  const candidate = result.product_id ?? result.productId ?? nestedProduct?.id ?? result.id;
  const productId = Number(candidate);
  return Number.isSafeInteger(productId) && productId > 0 ? productId : null;
}

export function productRpcWasReplay(value: unknown) {
  const result = resultObject(value);
  return result.replayed === true || result.already_processed === true;
}

function shapeProductSnapshot(product: Product, variantRows: JsonObject[]) {
  const raw = product as Product & { metadata_version?: unknown; structure_version?: unknown };
  const variants: JsonObject[] = variantRows.map((variant) => ({
    ...variant,
    quantity_on_hand: Number(variant.quantity_on_hand || 0),
    quantity_reserved: Number(variant.quantity_reserved || 0),
    quantity: Number(variant.quantity_on_hand ?? variant.quantity ?? 0),
  }));
  return {
    ...productForForm(product),
    metadata_version: Number(raw.metadata_version || 1),
    structure_version: Number(raw.structure_version || 1),
    variants,
    variant_procurement: Object.fromEntries(variants.map((variant) => [
      String(variant.size || "ONE SIZE").trim().toUpperCase(),
      {
        supplier_sku: String(variant.supplier_sku || ""),
        cost_price: variant.cost_price === null || variant.cost_price === undefined
          ? null
          : Number(variant.cost_price),
        reorder_level: variant.reorder_level === null || variant.reorder_level === undefined
          ? null
          : Number(variant.reorder_level),
      },
    ])),
  };
}

export function productSnapshotFromRpcResult(value: unknown) {
  const result = resultObject(value);
  if (!result.product || typeof result.product !== "object" || Array.isArray(result.product)) return null;
  const raw = result.product as JsonObject;
  const productId = Number(raw.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  const variants = Array.isArray(raw.variants)
    ? raw.variants.filter((variant): variant is JsonObject => Boolean(variant && typeof variant === "object" && !Array.isArray(variant)))
    : [];
  const { variants: _variants, ...product } = raw;
  return shapeProductSnapshot(product as unknown as Product, variants);
}

export function bulkProductResultFromRpcResult(value: unknown, expectedProductIds: number[]) {
  const result = resultObject(value);
  if (!Array.isArray(result.products) || !Array.isArray(result.items)) return null;
  const updatedCount = Number(result.updated_count);
  if (!Number.isSafeInteger(updatedCount) || updatedCount !== expectedProductIds.length) return null;
  if (result.products.length !== updatedCount || result.items.length !== updatedCount) return null;
  if (typeof result.replayed !== "boolean") return null;

  const productIds = result.products.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const productId = Number((entry as JsonObject).id);
    return Number.isSafeInteger(productId) && productId > 0 ? productId : null;
  });
  const itemIds = result.items.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const productId = Number((entry as JsonObject).product_id);
    return Number.isSafeInteger(productId) && productId > 0 ? productId : null;
  });
  if (productIds.some((productId) => productId === null) || itemIds.some((productId) => productId === null)) return null;

  const expected = [...expectedProductIds].sort((left, right) => left - right);
  const returnedProducts = (productIds as number[]).sort((left, right) => left - right);
  const returnedItems = (itemIds as number[]).sort((left, right) => left - right);
  if (expected.some((productId, index) => productId !== returnedProducts[index] || productId !== returnedItems[index])) {
    return null;
  }

  return result;
}

type ProductVariantSnapshot = JsonObject & {
  product_id: number | string;
  id: string;
};

export async function loadProductSnapshots(
  supabase: SupabaseClient,
  productRows: Product[],
) {
  const productIds = productRows.map((product) => Number(product.id)).filter(Number.isSafeInteger);
  if (productIds.length === 0) return [];

  const { data: variantRows, error: variantsError } = await (supabase as any)
    .from("product_variants")
    .select("id, product_id, variant_sku, barcode, size, color, price, cost_price, supplier_id, supplier_sku, reorder_level, active, sort_order, created_at, updated_at")
    .in("product_id", productIds)
    .order("sort_order")
    .order("id");
  if (variantsError) throw variantsError;

  const { data: balanceRows, error: balancesError } = await (supabase as any)
    .from("inventory_balances")
    .select("variant_id, quantity_on_hand, quantity_reserved, inventory_locations!inner(code), product_variants!inner(product_id)")
    .in("product_variants.product_id", productIds)
    .eq("inventory_locations.code", "MAIN_STORE");
  if (balancesError) throw balancesError;

  const balances = new Map<string, { quantity_on_hand: number; quantity_reserved: number }>();
  for (const row of balanceRows || []) {
    balances.set(String(row.variant_id), {
      quantity_on_hand: Number(row.quantity_on_hand || 0),
      quantity_reserved: Number(row.quantity_reserved || 0),
    });
  }

  const variantsByProduct = new Map<number, JsonObject[]>();
  for (const row of (variantRows || []) as ProductVariantSnapshot[]) {
    const productId = Number(row.product_id);
    const balance = balances.get(String(row.id)) || { quantity_on_hand: 0, quantity_reserved: 0 };
    const current = variantsByProduct.get(productId) || [];
    current.push({
      ...row,
      quantity_on_hand: balance.quantity_on_hand,
      quantity_reserved: balance.quantity_reserved,
      quantity: balance.quantity_on_hand,
    });
    variantsByProduct.set(productId, current);
  }

  return productRows.map((product) => shapeProductSnapshot(
    product,
    variantsByProduct.get(Number(product.id)) || [],
  ));
}

export async function loadProductSnapshot(supabase: SupabaseClient, productId: number) {
  const { data, error } = await (supabase as any)
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await loadProductSnapshots(supabase, [data as Product]))[0] || null;
}
