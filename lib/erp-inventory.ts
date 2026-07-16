// This module must only run on the server. Never import it from client components.

import { getSupabaseAdminClient } from "@/lib/supabase";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import type { VariantProcurement } from "@/lib/types";

type LegacyProductInventory = {
  id: number | string;
  sku: string;
  barcode?: string | null;
  color?: string | null;
  price?: number | string | null;
  stock?: number | string | null;
  size_stock?: Record<string, unknown> | null;
  is_active?: boolean | null;
  supplier_id?: string | null;
};

type ProductVariantRecord = {
  id: string;
  variant_sku: string;
  size?: string | null;
  color?: string | null;
  barcode?: string | null;
};

export type LegacyInventoryTarget = {
  size: string;
  color: string | null;
  targetQuantity: number;
  variantSku: string;
  barcode: string | null;
};

export type ProductInventoryReconciliation = {
  productId: number;
  legacyStock: number;
  erpStock: number;
  difference: number;
};

type InventoryMovementType =
  | "initial_migration"
  | "manual_adjustment"
  | "sale"
  | "return"
  | "transfer_in"
  | "transfer_out"
  | "reservation"
  | "release_reservation"
  | "correction";

export type SyncProductInventoryInput = {
  productId: number;
  reason: string;
  sourceType: string;
  sourceId?: string | number | null;
  movementType: InventoryMovementType;
  idempotencyKey: string;
  createdBy?: string | null;
  variantProcurement?: Record<string, VariantProcurement>;
};

export type SyncProductInventoryResult = {
  productId: number;
  variantCount: number;
  balanceUpdates: number;
  movementCount: number;
};

export type SyncProductVariantActiveError = {
  productId: number;
  message: string;
};

export type SyncProductVariantActiveResult = {
  updatedCount: number;
  warnings: SyncProductVariantActiveError[];
};

export type InventoryOverviewParams = {
  q?: string;
  size?: string;
  category?: string;
  subcategory?: string;
  zeroStock?: boolean;
  inactive?: boolean;
  limit?: number;
  offset?: number;
};

export type InventoryOverviewItem = {
  product_id: number;
  product_name: string;
  product_sku: string;
  category: string;
  subcategory: string;
  variant_id: string;
  variant_sku: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  supplier_sku: string | null;
  supplier_name: string | null;
  supplier_style_code: string | null;
  cost_price: number | null;
  reorder_level: number | null;
  price: number;
  active: boolean;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  legacy_stock: number;
  erp_product_stock: number;
  stock_matches_legacy: boolean;
  size_stock_matches_legacy: boolean;
};

export type InventoryMovementParams = {
  q?: string;
  variantId?: string;
  movementType?: string;
  sourceType?: string;
  limit?: number;
  offset?: number;
};

export type InventoryMovementItem = {
  id: string;
  variant_id: string;
  variant_sku: string;
  product_sku: string;
  product_name: string;
  movement_type: string;
  quantity_before: number;
  quantity_after: number;
  quantity_delta: number;
  reason: string;
  source_type: string | null;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type InventoryReconciliationResult = {
  stockVsBalanceMismatches: Array<{
    product_id: number;
    sku: string;
    legacy_stock: number;
    erp_stock: number;
  }>;
  sizeStockMismatches: Array<{
    product_id: number;
    sku: string;
    size: string;
    legacy_quantity: number;
    erp_quantity: number;
  }>;
  productsWithoutVariants: Array<{ product_id: number; sku: string }>;
  variantsWithoutMainStoreBalance: Array<{ variant_id: string; variant_sku: string; product_id: number }>;
  duplicateVariantSkus: Array<{ variant_sku: string; duplicate_count: number }>;
  duplicateBarcodes: Array<{ barcode: string; duplicate_count: number }>;
  reservedExceedsOnHand: Array<{
    balance_id: string;
    variant_id: string;
    quantity_reserved: number;
    quantity_on_hand: number;
  }>;
  blankMovementReasons: Array<{ movement_id: string; variant_id: string; movement_type: string }>;
  negativeBalances: Array<{
    balance_id: string;
    variant_id: string;
    location_id: string;
    quantity_on_hand: number;
    quantity_reserved: number;
  }>;
  duplicateOperationKeys: Array<{ operation_key: string; duplicate_count: number }>;
  movementDeltaMismatches: Array<{
    movement_id: string;
    variant_id: string;
    location_id: string;
    quantity_before: number;
    quantity_after: number;
    quantity_delta: number;
  }>;
  movementContinuityMismatches: Array<{
    variant_id: string;
    location_id: string;
    previous_movement_id: string;
    previous_quantity_after: number;
    movement_id: string;
    quantity_before: number;
  }>;
  balanceVsLatestMovementMismatches: Array<{
    balance_id: string;
    variant_id: string;
    location_id: string;
    balance_quantity_on_hand: number;
    latest_movement_id: string;
    latest_quantity_after: number;
  }>;
  balancesWithoutMovements: Array<{
    balance_id: string;
    variant_id: string;
    location_id: string;
    quantity_on_hand: number;
  }>;
  operationsMissingMovements: Array<{
    operation_key: string;
    operation_type: string;
    variant_id: string;
    location_id: string;
    quantity_before: number;
    quantity_after: number;
    quantity_delta: number;
  }>;
  runtimeHealth: {
    ready: boolean;
    version: string | null;
    apply_deployed: boolean;
    apply_executable: boolean;
    operations_table_deployed: boolean;
  };
};

function adminClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Admin Supabase client is not configured.");
  }
  return supabase;
}

function normalizeSize(value: string) {
  return value.trim().toUpperCase();
}

function variantSkuFor(productSku: string, size: string) {
  const normalizedSize = size
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalizedSize || normalizedSize === "ONE-SIZE") return productSku;
  return `${productSku}-${normalizedSize}`;
}

function numberQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function numberMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nonBlank(value: string) {
  return value.trim().length > 0;
}

function normalizedVariantIdentity(size: string | null | undefined, color: string | null | undefined) {
  return `${(size || "").trim().toUpperCase()}::${(color || "").trim().toUpperCase()}`;
}

function procurementForSize(
  values: Record<string, VariantProcurement> | undefined,
  size: string,
) {
  if (!values) return null;
  const target = normalizeSize(size);
  const match = Object.entries(values).find(([key]) => normalizeSize(key) === target)?.[1];
  if (!match) return null;
  const cost = match.cost_price === null || match.cost_price === undefined ? null : Number(match.cost_price);
  const reorder = match.reorder_level === null || match.reorder_level === undefined
    ? null
    : Math.max(0, Math.trunc(Number(match.reorder_level)));
  return {
    supplier_sku: String(match.supplier_sku || "").trim() || null,
    cost_price: Number.isFinite(cost) && Number(cost) >= 0 ? Number(cost) : null,
    reorder_level: Number.isFinite(reorder) ? reorder : null,
  };
}

function normalizedSizeStock(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const stock: Record<string, number> = {};
  for (const [size, quantity] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeSize(size);
    if (!normalized) continue;
    stock[normalized] = numberQuantity(quantity);
  }

  return Object.keys(stock).length > 0 ? stock : null;
}

function limitValue(value: unknown, fallback = 100, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function offsetValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function productDisplayName(product: Record<string, unknown>) {
  return (
    String(product.name_cn || "").trim() ||
    String(product.name_en || "").trim() ||
    String(product.name_gr || "").trim() ||
    String(product.sku || "").trim()
  );
}

export async function getMainInventoryLocation() {
  // ERP tables are newer than the lightweight local Supabase type map.
  const supabase = adminClient() as any;
  const { data, error } = await supabase
    .from("inventory_locations")
    .select("id, code, name, type, active")
    .eq("code", "MAIN_STORE")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load MAIN_STORE inventory location: ${error.message}`);
  }

  if (!data) {
    throw new Error("MAIN_STORE inventory location is missing. Run ERP Phase 1 migration first.");
  }

  return data;
}

export async function hasInventoryMovementsForProduct(productId: number) {
  const supabase = adminClient() as any;

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);

  if (variantsError) {
    throw new Error(`Failed to load product variants: ${variantsError.message}`);
  }

  const variantIds = (variants || [])
    .map((variant: { id?: string }) => variant.id)
    .filter(Boolean);
  if (variantIds.length === 0) return false;

  const { data: movement, error: movementError } = await supabase
    .from("stock_movements")
    .select("id")
    .in("variant_id", variantIds)
    .limit(1)
    .maybeSingle();

  if (movementError) {
    throw new Error(`Failed to check stock movements: ${movementError.message}`);
  }

  return Boolean(movement);
}

export async function hasStockMovementForIdempotencyKey(idempotencyKey: string) {
  const key = idempotencyKey.trim();
  if (!key) return false;

  const supabase = adminClient() as any;
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id")
    .like("idempotency_key", `${key}:%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check idempotency key: ${error.message}`);
  }

  return Boolean(data);
}

export async function getInventoryReconciliationForProduct(
  productId: number,
): Promise<ProductInventoryReconciliation> {
  const supabase = adminClient() as any;

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, sku, stock, size_stock")
    .eq("id", productId)
    .maybeSingle();

  if (productError) {
    throw new Error(`Failed to load product: ${productError.message}`);
  }

  if (!product) {
    throw new Error("Product not found.");
  }

  const legacyStock = buildLegacyInventoryTargets(product as LegacyProductInventory).reduce(
    (sum, target) => sum + target.targetQuantity,
    0,
  );

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);

  if (variantsError) {
    throw new Error(`Failed to load product variants: ${variantsError.message}`);
  }

  const variantIds = (variants || [])
    .map((variant: { id?: string }) => variant.id)
    .filter(Boolean);
  if (variantIds.length === 0) {
    return { productId, legacyStock, erpStock: 0, difference: 0 - legacyStock };
  }

  const { data: balances, error: balancesError } = await supabase
    .from("inventory_balances")
    .select("quantity_on_hand")
    .in("variant_id", variantIds);

  if (balancesError) {
    throw new Error(`Failed to load inventory balances: ${balancesError.message}`);
  }

  const erpStock = (balances || []).reduce(
    (sum: number, balance: { quantity_on_hand?: unknown }) =>
      sum + numberQuantity(balance.quantity_on_hand),
    0,
  );

  return {
    productId,
    legacyStock,
    erpStock,
    difference: erpStock - legacyStock,
  };
}

async function loadInventoryOverviewRows(): Promise<InventoryOverviewItem[]> {
  const supabase = adminClient() as any;
  const location = await getMainInventoryLocation();

  const [{ data: products, error: productsError }, { data: variants, error: variantsError }] =
    await Promise.all([
      fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
        .from("products")
        .select("id, sku, name_cn, name_en, name_gr, category, subcategory, price, stock, size_stock, is_active, supplier_id, supplier_style_code")
        .order("id")
        .range(from, to)),
      fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
        .from("product_variants")
        .select("id, product_id, variant_sku, barcode, size, color, price, active, supplier_sku, cost_price, reorder_level")
        .order("id")
        .range(from, to)),
    ]);

  if (productsError) {
    throw new Error(`Failed to load products for inventory overview: ${productsError.message}`);
  }
  if (variantsError) {
    throw new Error(`Failed to load variants for inventory overview: ${variantsError.message}`);
  }

  const productMap = new Map<number, Record<string, unknown>>();
  for (const product of products || []) {
    productMap.set(Number(product.id), product as Record<string, unknown>);
  }

  const supplierIds = Array.from(new Set((products || []).map((product: { supplier_id?: string | null }) => product.supplier_id).filter(Boolean))) as string[];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data: suppliers, error: suppliersError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
      .from("suppliers")
      .select("id, name")
      .order("id")
      .range(from, to));
    if (suppliersError) throw new Error(`Failed to load suppliers: ${suppliersError.message}`);
    for (const supplier of suppliers || []) supplierNames.set(String(supplier.id), String(supplier.name || ""));
  }

  const balancesByVariant = new Map<string, Record<string, unknown>>();
  if ((variants || []).length > 0) {
    const { data: balances, error: balancesError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
      .from("inventory_balances")
      .select("id, variant_id, location_id, quantity_on_hand, quantity_reserved")
      .eq("location_id", location.id)
      .order("id")
      .range(from, to));

    if (balancesError) {
      throw new Error(`Failed to load inventory balances: ${balancesError.message}`);
    }

    for (const balance of balances || []) {
      balancesByVariant.set(String(balance.variant_id), balance as Record<string, unknown>);
    }
  }

  const erpTotalsByProduct = new Map<number, number>();
  for (const variant of variants || []) {
    const productId = Number(variant.product_id);
    const balance = balancesByVariant.get(String(variant.id));
    const qty = numberQuantity(balance?.quantity_on_hand);
    if (variant.active !== false) {
      erpTotalsByProduct.set(productId, (erpTotalsByProduct.get(productId) || 0) + qty);
    }
  }

  const erpByProductAndSize = new Map<string, number>();
  for (const variant of variants || []) {
    if (variant.active === false) continue;
    const productId = Number(variant.product_id);
    const size = normalizeSize(String(variant.size || "ONE SIZE"));
    const balance = balancesByVariant.get(String(variant.id));
    const qty = numberQuantity(balance?.quantity_on_hand);
    erpByProductAndSize.set(`${productId}:${size}`, (erpByProductAndSize.get(`${productId}:${size}`) || 0) + qty);
  }

  const sizeStockMatchesByProduct = new Map<number, boolean>();
  for (const product of products || []) {
    const productId = Number(product.id);
    const sizeStock = normalizedSizeStock(product.size_stock);
    if (!sizeStock) {
      sizeStockMatchesByProduct.set(productId, true);
      continue;
    }

    const matches = Object.entries(sizeStock).every(([size, qty]) => {
      return (erpByProductAndSize.get(`${productId}:${normalizeSize(size)}`) || 0) === qty;
    });
    sizeStockMatchesByProduct.set(productId, matches);
  }

  return (variants || []).map((variant: Record<string, unknown>) => {
    const productId = Number(variant.product_id);
    const product = productMap.get(productId) || {};
    const balance = balancesByVariant.get(String(variant.id));
    const quantityOnHand = numberQuantity(balance?.quantity_on_hand);
    const quantityReserved = numberQuantity(balance?.quantity_reserved);
    const legacyStock = numberQuantity(product.stock);
    const erpProductStock = erpTotalsByProduct.get(productId) || 0;

    return {
      product_id: productId,
      product_name: productDisplayName(product),
      product_sku: String(product.sku || ""),
      category: String(product.category || ""),
      subcategory: String(product.subcategory || ""),
      variant_id: String(variant.id || ""),
      variant_sku: String(variant.variant_sku || ""),
      size: variant.size === null || variant.size === undefined ? null : String(variant.size),
      color: variant.color === null || variant.color === undefined ? null : String(variant.color),
      barcode: variant.barcode === null || variant.barcode === undefined ? null : String(variant.barcode),
      supplier_sku: variant.supplier_sku === null || variant.supplier_sku === undefined ? null : String(variant.supplier_sku),
      supplier_name: product.supplier_id ? supplierNames.get(String(product.supplier_id)) || null : null,
      supplier_style_code: product.supplier_style_code === null || product.supplier_style_code === undefined ? null : String(product.supplier_style_code),
      cost_price: numberMoney(variant.cost_price),
      reorder_level: variant.reorder_level === null || variant.reorder_level === undefined ? null : numberQuantity(variant.reorder_level),
      price: numberMoney(variant.price ?? product.price) ?? 0,
      active: variant.active !== false,
      quantity_on_hand: quantityOnHand,
      quantity_reserved: quantityReserved,
      quantity_available: Math.max(0, quantityOnHand - quantityReserved),
      legacy_stock: legacyStock,
      erp_product_stock: erpProductStock,
      stock_matches_legacy: legacyStock === erpProductStock,
      size_stock_matches_legacy: sizeStockMatchesByProduct.get(productId) !== false,
    } satisfies InventoryOverviewItem;
  });
}

export async function getInventoryOverview(params: InventoryOverviewParams = {}) {
  const limit = limitValue(params.limit, 100, 500);
  const offset = offsetValue(params.offset);
  const q = (params.q || "").trim().toLowerCase();
  const size = (params.size || "").trim().toUpperCase();
  const category = (params.category || "").trim().toLowerCase();
  const subcategory = (params.subcategory || "").trim().toLowerCase();
  const rows = await loadInventoryOverviewRows();

  let filtered: InventoryOverviewItem[] = rows;
  if (category) {
    filtered = filtered.filter((row) => row.category.toLowerCase() === category);
  }
  if (subcategory) {
    filtered = filtered.filter((row) => row.subcategory.toLowerCase() === subcategory);
  }
  if (q) {
    filtered = filtered.filter((row) => {
      return [
        row.product_name,
        row.product_sku,
        row.variant_sku,
        row.barcode || "",
        row.supplier_sku || "",
        row.supplier_name || "",
        row.supplier_style_code || "",
        row.color || "",
        row.size || "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }
  if (size) {
    filtered = filtered.filter((row) => (row.size || "").trim().toUpperCase() === size);
  }
  if (params.zeroStock) {
    filtered = filtered.filter((row) => row.quantity_on_hand === 0);
  }
  if (params.inactive) {
    filtered = filtered.filter((row) => !row.active);
  }

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
  };
}

export async function getInventoryMovements(params: InventoryMovementParams = {}) {
  const supabase = adminClient() as any;
  const limit = limitValue(params.limit, 100, 500);
  const offset = offsetValue(params.offset);
  const q = (params.q || "").trim().toLowerCase();
  const fetchLimit = q ? Math.min(1000, Math.max(limit + offset, 200)) : limit + offset;

  let query = supabase
    .from("stock_movements")
    .select("id, variant_id, movement_type, quantity_before, quantity_after, quantity_delta, reason, source_type, source_id, created_by, created_at")
    .order("created_at", { ascending: false })
    .range(0, fetchLimit - 1);

  if (params.variantId) {
    query = query.eq("variant_id", params.variantId);
  }
  if (params.movementType) {
    query = query.eq("movement_type", params.movementType);
  }
  if (params.sourceType) {
    query = query.eq("source_type", params.sourceType);
  }

  const { data: movements, error: movementsError } = await query;
  if (movementsError) {
    throw new Error(`Failed to load inventory movements: ${movementsError.message}`);
  }

  const variantIds = Array.from(new Set((movements || []).map((movement: { variant_id: string }) => movement.variant_id)));
  const variantsById = new Map<string, Record<string, unknown>>();
  const productIds = new Set<number>();

  if (variantIds.length > 0) {
    const { data: variants, error: variantsError } = await supabase
      .from("product_variants")
      .select("id, product_id, variant_sku")
      .in("id", variantIds);

    if (variantsError) {
      throw new Error(`Failed to load movement variants: ${variantsError.message}`);
    }

    for (const variant of variants || []) {
      variantsById.set(String(variant.id), variant as Record<string, unknown>);
      productIds.add(Number(variant.product_id));
    }
  }

  const productsById = new Map<number, Record<string, unknown>>();
  if (productIds.size > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, sku, name_cn, name_en, name_gr")
      .in("id", Array.from(productIds));

    if (productsError) {
      throw new Error(`Failed to load movement products: ${productsError.message}`);
    }

    for (const product of products || []) {
      productsById.set(Number(product.id), product as Record<string, unknown>);
    }
  }

  let items: InventoryMovementItem[] = (movements || []).map((movement: Record<string, unknown>) => {
    const variant = variantsById.get(String(movement.variant_id)) || {};
    const product = productsById.get(Number(variant.product_id)) || {};
    return {
      id: String(movement.id || ""),
      variant_id: String(movement.variant_id || ""),
      variant_sku: String(variant.variant_sku || ""),
      product_sku: String(product.sku || ""),
      product_name: productDisplayName(product),
      movement_type: String(movement.movement_type || ""),
      quantity_before: numberQuantity(movement.quantity_before),
      quantity_after: numberQuantity(movement.quantity_after),
      quantity_delta: Number(movement.quantity_delta) || 0,
      reason: String(movement.reason || ""),
      source_type: movement.source_type === null || movement.source_type === undefined ? null : String(movement.source_type),
      source_id: movement.source_id === null || movement.source_id === undefined ? null : String(movement.source_id),
      created_by: movement.created_by === null || movement.created_by === undefined ? null : String(movement.created_by),
      created_at: String(movement.created_at || ""),
    } satisfies InventoryMovementItem;
  });

  if (q) {
    items = items.filter((item) => {
      return [
        item.variant_sku,
        item.product_sku,
        item.product_name,
        item.reason,
        item.source_type || "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }

  return {
    items: q ? items.slice(offset, offset + limit) : items.slice(offset),
    total: q ? items.length : undefined,
    limit,
    offset,
  };
}

export async function getInventoryReconciliation(): Promise<InventoryReconciliationResult> {
  const supabase = adminClient() as any;
  const rows = await loadInventoryOverviewRows();

  const stockVsBalanceMismatches = Array.from(
    new Map(rows.map((row: InventoryOverviewItem) => [row.product_id, row])).values(),
  )
    .filter((row: InventoryOverviewItem) => !row.stock_matches_legacy)
    .map((row: InventoryOverviewItem) => ({
      product_id: row.product_id,
      sku: row.product_sku,
      legacy_stock: row.legacy_stock,
      erp_stock: row.erp_product_stock,
    }));

  const productsById = new Map<number, InventoryOverviewItem[]>();
  rows.forEach((row: InventoryOverviewItem) => {
    const list = productsById.get(row.product_id) || [];
    list.push(row);
    productsById.set(row.product_id, list);
  });

  const { data: products, error: productsError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
    .from("products")
    .select("id, sku, size_stock")
    .order("id")
    .range(from, to));

  if (productsError) {
    throw new Error(`Failed to load products for reconciliation: ${productsError.message}`);
  }

  const sizeStockMismatches: InventoryReconciliationResult["sizeStockMismatches"] = [];
  const productsWithoutVariants: InventoryReconciliationResult["productsWithoutVariants"] = [];
  for (const product of products || []) {
    const productId = Number(product.id);
    const variants = productsById.get(productId) || [];
    if (variants.length === 0) {
      productsWithoutVariants.push({ product_id: productId, sku: String(product.sku || "") });
    }
    const legacySizeStock = normalizedSizeStock(product.size_stock);
    if (!legacySizeStock) continue;
    for (const [size, legacyQuantity] of Object.entries(legacySizeStock)) {
      const erpQuantity = variants
        .filter((variant) => variant.active && normalizeSize(variant.size || "ONE SIZE") === normalizeSize(size))
        .reduce((sum, variant) => sum + variant.quantity_on_hand, 0);
      if (legacyQuantity !== erpQuantity) {
        sizeStockMismatches.push({
          product_id: productId,
          sku: String(product.sku || ""),
          size,
          legacy_quantity: legacyQuantity,
          erp_quantity: erpQuantity,
        });
      }
    }
  }

  const mainLocation = await getMainInventoryLocation();
  const { data: allVariants, error: allVariantsError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
    .from("product_variants")
    .select("id, product_id, variant_sku")
    .order("id")
    .range(from, to));

  if (allVariantsError) {
    throw new Error(`Failed to load variants for reconciliation: ${allVariantsError.message}`);
  }

  const allVariantIds = (allVariants || []).map((variant) => String(variant.id || ""));
  const variantIdsWithMainBalance = new Set<string>();
  if (allVariantIds.length > 0) {
    const { data: mainBalances, error: mainBalancesError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
      .from("inventory_balances")
      .select("variant_id")
      .eq("location_id", mainLocation.id)
      .order("id")
      .range(from, to));

    if (mainBalancesError) {
      throw new Error(`Failed to load MAIN_STORE balances for reconciliation: ${mainBalancesError.message}`);
    }

    for (const balance of mainBalances || []) {
      variantIdsWithMainBalance.add(String(balance.variant_id));
    }
  }

  const variantsWithoutMainStoreBalance = (allVariants || [])
    .filter((variant: Record<string, unknown>) => !variantIdsWithMainBalance.has(String(variant.id)))
    .map((variant: Record<string, unknown>) => ({
      variant_id: String(variant.id || ""),
      variant_sku: String(variant.variant_sku || ""),
      product_id: Number(variant.product_id),
    }));

  const variantSkuCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  rows.forEach((row: InventoryOverviewItem) => {
    variantSkuCounts.set(row.variant_sku, (variantSkuCounts.get(row.variant_sku) || 0) + 1);
    if (row.barcode) barcodeCounts.set(row.barcode, (barcodeCounts.get(row.barcode) || 0) + 1);
  });

  const duplicateVariantSkus = Array.from(variantSkuCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([variant_sku, duplicate_count]) => ({ variant_sku, duplicate_count }));
  const duplicateBarcodes = Array.from(barcodeCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([barcode, duplicate_count]) => ({ barcode, duplicate_count }));

  const { data: balances, error: balancesError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
    .from("inventory_balances")
    .select("id, variant_id, location_id, quantity_on_hand, quantity_reserved")
    .order("id")
    .range(from, to));

  if (balancesError) {
    throw new Error(`Failed to load balances for reconciliation: ${balancesError.message}`);
  }

  const reservedExceedsOnHand = (balances || [])
    .filter((balance: Record<string, unknown>) => {
      const onHand = numberQuantity(balance.quantity_on_hand);
      const reserved = numberQuantity(balance.quantity_reserved);
      return reserved > onHand;
    })
    .map((balance: Record<string, unknown>) => ({
      balance_id: String(balance.id || ""),
      variant_id: String(balance.variant_id || ""),
      quantity_reserved: numberQuantity(balance.quantity_reserved),
      quantity_on_hand: numberQuantity(balance.quantity_on_hand),
    }));

  const negativeBalances = (balances || [])
    .filter((balance: Record<string, unknown>) => {
      const onHand = Number(balance.quantity_on_hand);
      const reserved = Number(balance.quantity_reserved);
      return !Number.isFinite(onHand) || !Number.isFinite(reserved) || onHand < 0 || reserved < 0;
    })
    .map((balance: Record<string, unknown>) => ({
      balance_id: String(balance.id || ""),
      variant_id: String(balance.variant_id || ""),
      location_id: String(balance.location_id || ""),
      quantity_on_hand: Number(balance.quantity_on_hand),
      quantity_reserved: Number(balance.quantity_reserved),
    }));

  const { data: movements, error: movementsError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
    .from("stock_movements")
    .select("id, variant_id, location_id, movement_type, quantity_before, quantity_after, quantity_delta, reason, source_type, idempotency_key, created_at")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to));

  if (movementsError) {
    throw new Error(`Failed to load movements for reconciliation: ${movementsError.message}`);
  }

  const movementDeltaMismatches: InventoryReconciliationResult["movementDeltaMismatches"] = [];
  const movementContinuityMismatches: InventoryReconciliationResult["movementContinuityMismatches"] = [];
  const movementGroups = new Map<string, Array<Record<string, unknown>>>();
  for (const movement of movements || []) {
    const before = Number(movement.quantity_before);
    const after = Number(movement.quantity_after);
    const delta = Number(movement.quantity_delta);
    if (!Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(delta) || after - before !== delta) {
      movementDeltaMismatches.push({
        movement_id: String(movement.id || ""),
        variant_id: String(movement.variant_id || ""),
        location_id: String(movement.location_id || ""),
        quantity_before: before,
        quantity_after: after,
        quantity_delta: delta,
      });
    }
    const groupKey = `${String(movement.variant_id || "")}:${String(movement.location_id || "")}`;
    const group = movementGroups.get(groupKey) || [];
    group.push(movement as Record<string, unknown>);
    movementGroups.set(groupKey, group);
  }

  for (const group of movementGroups.values()) {
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      const previousAfter = Number(previous.quantity_after);
      const currentBefore = Number(current.quantity_before);
      if (previousAfter !== currentBefore) {
        movementContinuityMismatches.push({
          variant_id: String(current.variant_id || ""),
          location_id: String(current.location_id || ""),
          previous_movement_id: String(previous.id || ""),
          previous_quantity_after: previousAfter,
          movement_id: String(current.id || ""),
          quantity_before: currentBefore,
        });
      }
    }
  }

  const balanceVsLatestMovementMismatches: InventoryReconciliationResult["balanceVsLatestMovementMismatches"] = [];
  const balancesWithoutMovements: InventoryReconciliationResult["balancesWithoutMovements"] = [];
  for (const balance of balances || []) {
    const groupKey = `${String(balance.variant_id || "")}:${String(balance.location_id || "")}`;
    const group = movementGroups.get(groupKey) || [];
    const balanceQuantity = Number(balance.quantity_on_hand);
    const latest = group.at(-1);
    if (!latest) {
      if (balanceQuantity !== 0) {
        balancesWithoutMovements.push({
          balance_id: String(balance.id || ""),
          variant_id: String(balance.variant_id || ""),
          location_id: String(balance.location_id || ""),
          quantity_on_hand: balanceQuantity,
        });
      }
      continue;
    }
    const latestAfter = Number(latest.quantity_after);
    if (latestAfter !== balanceQuantity) {
      balanceVsLatestMovementMismatches.push({
        balance_id: String(balance.id || ""),
        variant_id: String(balance.variant_id || ""),
        location_id: String(balance.location_id || ""),
        balance_quantity_on_hand: balanceQuantity,
        latest_movement_id: String(latest.id || ""),
        latest_quantity_after: latestAfter,
      });
    }
  }

  const { data: operations, error: operationsError } = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) => supabase
    .from("inventory_operations")
    .select("id, operation_key, operation_type, variant_id, location_id, quantity_before, quantity_after, quantity_delta")
    .order("id")
    .range(from, to));
  if (operationsError) {
    throw new Error(`Failed to load inventory operation keys for reconciliation: ${operationsError.message}`);
  }
  const operationCounts = new Map<string, number>();
  for (const operation of operations || []) {
    const key = String(operation.operation_key || "");
    operationCounts.set(key, (operationCounts.get(key) || 0) + 1);
  }
  const duplicateOperationKeys = Array.from(operationCounts.entries())
    .filter(([, duplicateCount]) => duplicateCount > 1)
    .map(([operation_key, duplicate_count]) => ({ operation_key, duplicate_count }));
  const movementOperationKeys = new Set(
    (movements || [])
      .map((movement: Record<string, unknown>) => String(movement.idempotency_key || ""))
      .filter(Boolean),
  );
  const operationsMissingMovements = (operations || [])
    .filter((operation: Record<string, unknown>) => (
      Number(operation.quantity_delta) !== 0
      && !movementOperationKeys.has(String(operation.operation_key || ""))
    ))
    .map((operation: Record<string, unknown>) => ({
      operation_key: String(operation.operation_key || ""),
      operation_type: String(operation.operation_type || ""),
      variant_id: String(operation.variant_id || ""),
      location_id: String(operation.location_id || ""),
      quantity_before: Number(operation.quantity_before),
      quantity_after: Number(operation.quantity_after),
      quantity_delta: Number(operation.quantity_delta),
    }));

  const { data: runtimeHealthData, error: runtimeHealthError } = await supabase.rpc("inventory_runtime_health_rpc");
  if (runtimeHealthError) {
    throw new Error(`Failed to load inventory RPC health: ${runtimeHealthError.message}`);
  }
  const health = (runtimeHealthData || {}) as Record<string, unknown>;
  const runtimeHealth = {
    ready: health.ready === true,
    version: typeof health.version === "string" ? health.version : null,
    apply_deployed: health.apply_deployed === true,
    apply_executable: health.apply_executable === true,
    operations_table_deployed: health.operations_table_deployed === true,
  };

  return {
    stockVsBalanceMismatches,
    sizeStockMismatches,
    productsWithoutVariants,
    variantsWithoutMainStoreBalance,
    duplicateVariantSkus,
    duplicateBarcodes,
    reservedExceedsOnHand,
    blankMovementReasons: (movements || [])
      .filter((movement: Record<string, unknown>) => !String(movement.reason || "").trim())
      .map((movement: Record<string, unknown>) => ({
        movement_id: String(movement.id || ""),
        variant_id: String(movement.variant_id || ""),
        movement_type: String(movement.movement_type || ""),
      })),
    negativeBalances,
    duplicateOperationKeys,
    movementDeltaMismatches,
    movementContinuityMismatches,
    balanceVsLatestMovementMismatches,
    balancesWithoutMovements,
    operationsMissingMovements,
    runtimeHealth,
  };
}

export async function syncProductVariantActiveFromLegacy(
  productIds: number[],
): Promise<SyncProductVariantActiveResult> {
  const ids = Array.from(
    new Set(productIds.filter((id) => Number.isFinite(id)).map((id) => Math.trunc(id))),
  );

  if (ids.length === 0) {
    return { updatedCount: 0, warnings: [] };
  }

  const supabase = adminClient() as any;
  const warnings: SyncProductVariantActiveError[] = [];
  let updatedCount = 0;

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, is_active")
    .in("id", ids);

  if (productsError) {
    throw new Error(`Failed to load products for active sync: ${productsError.message}`);
  }

  const productMap = new Map<number, boolean>();
  for (const product of products || []) {
    productMap.set(Number(product.id), product.is_active !== false);
  }

  for (const id of ids) {
    const active = productMap.get(id);
    if (active === undefined) {
      warnings.push({ productId: id, message: "Product not found for variant active sync." });
      continue;
    }

    const { data: variants, error: variantsError } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", id);

    if (variantsError) {
      warnings.push({ productId: id, message: variantsError.message });
      continue;
    }

    if (!variants || variants.length === 0) {
      warnings.push({ productId: id, message: "Product has no ERP variants to sync." });
      continue;
    }

    const { error: updateError } = await supabase
      .from("product_variants")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("product_id", id);

    if (updateError) {
      warnings.push({ productId: id, message: updateError.message });
      continue;
    }

    updatedCount += variants.length;
  }

  return { updatedCount, warnings };
}

export function buildLegacyInventoryTargets(product: LegacyProductInventory): LegacyInventoryTarget[] {
  const productSku = typeof product.sku === "string" ? product.sku.trim() : "";
  const color = typeof product.color === "string" && product.color.trim() ? product.color.trim() : null;
  const sizeStock = normalizedSizeStock(product.size_stock);

  if (sizeStock) {
    return Object.entries(sizeStock).map(([size, quantity]) => ({
      size,
      color,
      targetQuantity: quantity,
      variantSku: variantSkuFor(productSku, size),
      barcode: null,
    }));
  }

  return [
    {
      size: "ONE SIZE",
      color,
      targetQuantity: numberQuantity(product.stock),
      variantSku: productSku,
      barcode:
        typeof product.barcode === "string" && product.barcode.trim()
          ? product.barcode.trim()
          : null,
    },
  ];
}

export async function syncProductInventoryFromLegacy(input: SyncProductInventoryInput): Promise<SyncProductInventoryResult> {
  if (!Number.isFinite(input.productId)) {
    throw new Error("Product ID is required for inventory sync.");
  }
  if (!nonBlank(input.reason)) {
    throw new Error("Inventory movement reason is required.");
  }
  if (!nonBlank(input.sourceType)) {
    throw new Error("Inventory movement sourceType is required.");
  }
  if (!nonBlank(input.idempotencyKey)) {
    throw new Error("Inventory movement idempotencyKey is required.");
  }

  const supabase = adminClient() as any;
  const location = await getMainInventoryLocation();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, sku, barcode, color, price, stock, size_stock, is_active, supplier_id")
    .eq("id", input.productId)
    .maybeSingle();

  if (productError) {
    throw new Error(`Failed to load product for inventory sync: ${productError.message}`);
  }
  if (!product) {
    throw new Error("Product not found for inventory sync.");
  }

  const targets = buildLegacyInventoryTargets(product as LegacyProductInventory);
  if (targets.length === 0) {
    throw new Error("No legacy inventory targets could be built.");
  }

  let balanceUpdates = 0;
  let movementCount = 0;
  const targetVariantSkus = new Set(targets.map((target) => target.variantSku));

  for (const [index, target] of targets.entries()) {
    const targetBarcode = typeof target.barcode === "string" && target.barcode.trim()
      ? target.barcode.trim()
      : null;
    let variantIdentityQuery = supabase
      .from("product_variants")
      .select("id, variant_sku, size, color, barcode")
      .eq("product_id", input.productId)
      .eq("size", target.size);

    variantIdentityQuery =
      target.color === null
        ? variantIdentityQuery.is("color", null)
        : variantIdentityQuery.eq("color", target.color);

    const { data: existingVariantByIdentity, error: existingVariantByIdentityError } =
      await variantIdentityQuery.maybeSingle();

    if (existingVariantByIdentityError) {
      throw new Error(
        `Failed to read product variant ${target.variantSku}: ${existingVariantByIdentityError.message}`,
      );
    }

    let existingVariant = existingVariantByIdentity as ProductVariantRecord | null;
    if (!existingVariant) {
      const { data: existingVariantBySku, error: existingVariantBySkuError } = await supabase
        .from("product_variants")
        .select("id, variant_sku, size, color, barcode")
        .eq("variant_sku", target.variantSku)
        .maybeSingle();

      if (existingVariantBySkuError) {
        throw new Error(
          `Failed to read product variant ${target.variantSku}: ${existingVariantBySkuError.message}`,
        );
      }
      existingVariant = existingVariantBySku as ProductVariantRecord | null;
    }

    const variantPayload: Record<string, unknown> = {
      product_id: input.productId,
      supplier_id: product.supplier_id || null,
      variant_sku: target.variantSku,
      size: target.size,
      color: target.color,
      price: numberMoney(product.price),
      active: product.is_active !== false,
      sort_order: index,
      updated_at: new Date().toISOString(),
    };

    const procurement = procurementForSize(input.variantProcurement, target.size);
    if (procurement) {
      variantPayload.supplier_sku = procurement.supplier_sku;
      variantPayload.cost_price = procurement.cost_price;
      variantPayload.reorder_level = procurement.reorder_level;
    }

    if (!existingVariant || (!existingVariant.barcode && targetBarcode)) {
      variantPayload.barcode = targetBarcode;
    }

    const variantMutation = existingVariant
      ? supabase
          .from("product_variants")
          .update(variantPayload)
          .eq("id", existingVariant.id)
          .select("id, variant_sku")
          .single()
      : supabase
          .from("product_variants")
          .insert(variantPayload)
          .select("id, variant_sku")
          .single();

    const { data: variant, error: variantError } = await variantMutation;

    if (variantError) {
      throw new Error(`Failed to upsert product variant ${target.variantSku}: ${variantError.message}`);
    }

    const { data: existingBalance, error: balanceReadError } = await supabase
      .from("inventory_balances")
      .select("id, quantity_on_hand, quantity_reserved")
      .eq("variant_id", variant.id)
      .eq("location_id", location.id)
      .maybeSingle();

    if (balanceReadError) {
      throw new Error(`Failed to read inventory balance for ${target.variantSku}: ${balanceReadError.message}`);
    }

    const before = existingBalance ? numberQuantity(existingBalance.quantity_on_hand) : 0;
    const after = target.targetQuantity;
    const reserved = existingBalance ? numberQuantity(existingBalance.quantity_reserved) : 0;
    const nextReserved = Math.min(reserved, after);

    if (!existingBalance) {
      const { error: insertBalanceError } = await supabase.from("inventory_balances").insert({
        variant_id: variant.id,
        location_id: location.id,
        quantity_on_hand: after,
        quantity_reserved: 0,
        updated_at: new Date().toISOString(),
      });

      if (insertBalanceError) {
        throw new Error(`Failed to create inventory balance for ${target.variantSku}: ${insertBalanceError.message}`);
      }
      balanceUpdates += 1;
    } else if (before !== after || reserved !== nextReserved) {
      const { error: updateBalanceError } = await supabase
        .from("inventory_balances")
        .update({
          quantity_on_hand: after,
          quantity_reserved: nextReserved,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingBalance.id);

      if (updateBalanceError) {
        throw new Error(`Failed to update inventory balance for ${target.variantSku}: ${updateBalanceError.message}`);
      }
      balanceUpdates += 1;
    }

    if (before === after) {
      continue;
    }

    const movementKey = `${input.idempotencyKey.trim()}:${target.variantSku}`;
    const { data: existingMovement, error: movementReadError } = await supabase
      .from("stock_movements")
      .select("id")
      .eq("idempotency_key", movementKey)
      .maybeSingle();

    if (movementReadError) {
      throw new Error(`Failed to check movement idempotency for ${target.variantSku}: ${movementReadError.message}`);
    }

    if (existingMovement) {
      continue;
    }

    const { error: movementError } = await supabase.from("stock_movements").insert({
      variant_id: variant.id,
      location_id: location.id,
      movement_type: input.movementType,
      quantity_delta: after - before,
      quantity_before: before,
      quantity_after: after,
      reason: input.reason.trim(),
      source_type: input.sourceType.trim(),
      source_id: input.sourceId === null || input.sourceId === undefined ? null : String(input.sourceId),
      idempotency_key: movementKey,
      created_by: input.createdBy || "admin",
    });

    if (movementError) {
      throw new Error(`Failed to write stock movement for ${target.variantSku}: ${movementError.message}`);
    }

    movementCount += 1;
  }

  const targetIdentities = new Set(
    targets.map((target) => normalizedVariantIdentity(target.size, target.color)),
  );
  const { data: existingVariants, error: existingVariantsError } = await supabase
    .from("product_variants")
    .select("id, variant_sku, size, color")
    .eq("product_id", input.productId);

  if (existingVariantsError) {
    throw new Error(`Failed to load existing product variants: ${existingVariantsError.message}`);
  }

  const staleVariants = ((existingVariants || []) as ProductVariantRecord[]).filter((variant) => {
    return (
      !targetVariantSkus.has(variant.variant_sku) &&
      !targetIdentities.has(normalizedVariantIdentity(variant.size, variant.color))
    );
  });

  for (const variant of staleVariants) {
    const { error: deactivateError } = await supabase
      .from("product_variants")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", variant.id);

    if (deactivateError) {
      throw new Error(`Failed to deactivate stale variant ${variant.variant_sku}: ${deactivateError.message}`);
    }

    const { data: balance, error: staleBalanceError } = await supabase
      .from("inventory_balances")
      .select("id, quantity_on_hand, quantity_reserved")
      .eq("variant_id", variant.id)
      .eq("location_id", location.id)
      .maybeSingle();

    if (staleBalanceError) {
      throw new Error(`Failed to read stale balance for ${variant.variant_sku}: ${staleBalanceError.message}`);
    }

    const before = balance ? numberQuantity(balance.quantity_on_hand) : 0;
    if (!balance || before === 0) continue;

    const { error: zeroBalanceError } = await supabase
      .from("inventory_balances")
      .update({
        quantity_on_hand: 0,
        quantity_reserved: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", balance.id);

    if (zeroBalanceError) {
      throw new Error(`Failed to zero stale balance for ${variant.variant_sku}: ${zeroBalanceError.message}`);
    }

    balanceUpdates += 1;
    const movementKey = `${input.idempotencyKey.trim()}:${variant.variant_sku}:stale`;
    const { data: existingMovement, error: movementReadError } = await supabase
      .from("stock_movements")
      .select("id")
      .eq("idempotency_key", movementKey)
      .maybeSingle();

    if (movementReadError) {
      throw new Error(`Failed to check stale movement idempotency for ${variant.variant_sku}: ${movementReadError.message}`);
    }

    if (existingMovement) continue;

    const { error: movementError } = await supabase.from("stock_movements").insert({
      variant_id: variant.id,
      location_id: location.id,
      movement_type: input.movementType,
      quantity_delta: 0 - before,
      quantity_before: before,
      quantity_after: 0,
      reason: input.reason.trim(),
      source_type: input.sourceType.trim(),
      source_id: input.sourceId === null || input.sourceId === undefined ? null : String(input.sourceId),
      idempotency_key: movementKey,
      created_by: input.createdBy || "admin",
    });

    if (movementError) {
      throw new Error(`Failed to write stale stock movement for ${variant.variant_sku}: ${movementError.message}`);
    }

    movementCount += 1;
  }

  return {
    productId: input.productId,
    variantCount: targets.length,
    balanceUpdates,
    movementCount,
  };
}
