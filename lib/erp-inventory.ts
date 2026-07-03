// This module must only run on the server. Never import it from client components.

import { getSupabaseAdminClient } from "@/lib/supabase";

type LegacyProductInventory = {
  id: number | string;
  sku: string;
  barcode?: string | null;
  color?: string | null;
  price?: number | string | null;
  stock?: number | string | null;
  size_stock?: Record<string, unknown> | null;
  is_active?: boolean | null;
};

type ProductVariantRecord = {
  id: string;
  variant_sku: string;
  size?: string | null;
  color?: string | null;
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
  zeroStock?: boolean;
  inactive?: boolean;
  limit?: number;
  offset?: number;
};

export type InventoryOverviewItem = {
  product_id: number;
  product_name: string;
  product_sku: string;
  variant_id: string;
  variant_sku: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
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
};

export type AdjustInventoryVariantInput = {
  variantId: string;
  mode: "set_to" | "adjust_by";
  quantity: number;
  reason: string;
  clientRequestId: string;
  createdBy?: string | null;
};

export type AdjustInventoryVariantResult = {
  variantId: string;
  productId: number;
  quantityBefore: number;
  quantityAfter: number;
  quantityDelta: number;
  alreadyProcessed: boolean;
  noChange: boolean;
  legacySyncWarning?: string;
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
      supabase
        .from("products")
        .select("id, sku, name_cn, name_en, name_gr, stock, size_stock, is_active"),
      supabase
        .from("product_variants")
        .select("id, product_id, variant_sku, barcode, size, color, active"),
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

  const variantIds = (variants || []).map((variant: { id: string }) => variant.id);
  const balancesByVariant = new Map<string, Record<string, unknown>>();
  if (variantIds.length > 0) {
    const { data: balances, error: balancesError } = await supabase
      .from("inventory_balances")
      .select("id, variant_id, location_id, quantity_on_hand, quantity_reserved")
      .eq("location_id", location.id)
      .in("variant_id", variantIds);

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
      variant_id: String(variant.id || ""),
      variant_sku: String(variant.variant_sku || ""),
      size: variant.size === null || variant.size === undefined ? null : String(variant.size),
      color: variant.color === null || variant.color === undefined ? null : String(variant.color),
      barcode: variant.barcode === null || variant.barcode === undefined ? null : String(variant.barcode),
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
  const rows = await loadInventoryOverviewRows();

  let filtered: InventoryOverviewItem[] = rows;
  if (q) {
    filtered = filtered.filter((row) => {
      return [
        row.product_name,
        row.product_sku,
        row.variant_sku,
        row.barcode || "",
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

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, sku, size_stock");

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
  const { data: allVariants, error: allVariantsError } = await supabase
    .from("product_variants")
    .select("id, product_id, variant_sku");

  if (allVariantsError) {
    throw new Error(`Failed to load variants for reconciliation: ${allVariantsError.message}`);
  }

  const allVariantIds = (allVariants || []).map((variant: { id: string }) => variant.id);
  const variantIdsWithMainBalance = new Set<string>();
  if (allVariantIds.length > 0) {
    const { data: mainBalances, error: mainBalancesError } = await supabase
      .from("inventory_balances")
      .select("variant_id")
      .eq("location_id", mainLocation.id)
      .in("variant_id", allVariantIds);

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

  const { data: balances, error: balancesError } = await supabase
    .from("inventory_balances")
    .select("id, variant_id, quantity_on_hand, quantity_reserved");

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

  const { data: movementReasons, error: movementsError } = await supabase
    .from("stock_movements")
    .select("id, variant_id, movement_type, reason");

  if (movementsError) {
    throw new Error(`Failed to load movement reasons for reconciliation: ${movementsError.message}`);
  }

  return {
    stockVsBalanceMismatches,
    sizeStockMismatches,
    productsWithoutVariants,
    variantsWithoutMainStoreBalance,
    duplicateVariantSkus,
    duplicateBarcodes,
    reservedExceedsOnHand,
    blankMovementReasons: (movementReasons || [])
      .filter((movement: Record<string, unknown>) => !String(movement.reason || "").trim())
      .map((movement: Record<string, unknown>) => ({
        movement_id: String(movement.id || ""),
        variant_id: String(movement.variant_id || ""),
        movement_type: String(movement.movement_type || ""),
      })),
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
    .select("id, sku, barcode, color, price, stock, size_stock, is_active")
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
    let variantIdentityQuery = supabase
      .from("product_variants")
      .select("id, variant_sku, size, color")
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

    const variantPayload = {
      product_id: input.productId,
      variant_sku: target.variantSku,
      barcode: target.barcode,
      size: target.size,
      color: target.color,
      price: numberMoney(product.price),
      active: product.is_active !== false,
      sort_order: index,
      updated_at: new Date().toISOString(),
    };

    const variantMutation = existingVariantByIdentity
      ? supabase
          .from("product_variants")
          .update(variantPayload)
          .eq("id", existingVariantByIdentity.id)
          .select("id, variant_sku")
          .single()
      : supabase
          .from("product_variants")
          .upsert(variantPayload, { onConflict: "variant_sku" })
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
      .update({ active: false, barcode: null, updated_at: new Date().toISOString() })
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

export async function syncLegacyStockFromErp(productId: number) {
  if (!Number.isFinite(productId)) {
    throw new Error("Product ID is required for legacy stock sync.");
  }

  const supabase = adminClient() as any;
  const location = await getMainInventoryLocation();

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("id, size, active, sort_order")
    .eq("product_id", Math.trunc(productId))
    .order("sort_order", { ascending: true });

  if (variantsError) {
    throw new Error(`Failed to load variants for legacy stock sync: ${variantsError.message}`);
  }

  const activeVariants = (variants || []).filter((variant: Record<string, unknown>) => variant.active !== false);
  const variantIds = activeVariants.map((variant: Record<string, unknown>) => String(variant.id));
  const balanceByVariantId = new Map<string, number>();

  if (variantIds.length > 0) {
    const { data: balances, error: balancesError } = await supabase
      .from("inventory_balances")
      .select("variant_id, quantity_on_hand")
      .eq("location_id", location.id)
      .in("variant_id", variantIds);

    if (balancesError) {
      throw new Error(`Failed to load balances for legacy stock sync: ${balancesError.message}`);
    }

    for (const balance of balances || []) {
      balanceByVariantId.set(String(balance.variant_id), numberQuantity(balance.quantity_on_hand));
    }
  }

  const sizeStock: Record<string, number> = {};
  let stock = 0;
  for (const variant of activeVariants) {
    const variantId = String(variant.id);
    const quantity = balanceByVariantId.get(variantId) || 0;
    const size = String(variant.size || "ONE SIZE").trim() || "ONE SIZE";
    sizeStock[size] = (sizeStock[size] || 0) + quantity;
    stock += quantity;
  }

  const sizes = Object.keys(sizeStock).join(",");
  const { error: updateError } = await supabase
    .from("products")
    .update({
      stock,
      size_stock: sizeStock,
      sizes,
    })
    .eq("id", Math.trunc(productId));

  if (updateError) {
    throw new Error(`Failed to sync ERP stock back to product: ${updateError.message}`);
  }

  return {
    productId: Math.trunc(productId),
    stock,
    size_stock: sizeStock,
    sizes,
  };
}

export async function adjustInventoryVariant(
  input: AdjustInventoryVariantInput,
): Promise<AdjustInventoryVariantResult> {
  const variantId = typeof input.variantId === "string" ? input.variantId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const clientRequestId = typeof input.clientRequestId === "string" ? input.clientRequestId.trim() : "";

  if (!variantId) {
    throw new Error("Variant ID is required.");
  }
  if (input.mode !== "set_to" && input.mode !== "adjust_by") {
    throw new Error("Invalid adjustment mode.");
  }
  if (!Number.isInteger(input.quantity)) {
    throw new Error("Quantity must be an integer.");
  }
  if (!reason) {
    throw new Error("Adjustment reason is required.");
  }
  if (!clientRequestId) {
    throw new Error("clientRequestId is required.");
  }

  const supabase = adminClient() as any;
  const location = await getMainInventoryLocation();
  const idempotencyKey = `admin_inventory_adjustment:${clientRequestId}:${variantId}`;

  const { data: existingMovement, error: movementReadError } = await supabase
    .from("stock_movements")
    .select("id, quantity_before, quantity_after, quantity_delta, variant_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (movementReadError) {
    throw new Error(`Failed to check inventory adjustment idempotency: ${movementReadError.message}`);
  }

  const { data: variant, error: variantError } = await supabase
    .from("product_variants")
    .select("id, product_id, variant_sku")
    .eq("id", variantId)
    .maybeSingle();

  if (variantError) {
    throw new Error(`Failed to load variant for adjustment: ${variantError.message}`);
  }
  if (!variant) {
    throw new Error("Variant not found.");
  }

  if (existingMovement) {
    return {
      variantId,
      productId: Number(variant.product_id),
      quantityBefore: numberQuantity(existingMovement.quantity_before),
      quantityAfter: numberQuantity(existingMovement.quantity_after),
      quantityDelta: Number(existingMovement.quantity_delta) || 0,
      alreadyProcessed: true,
      noChange: false,
    };
  }

  const { data: balance, error: balanceError } = await supabase
    .from("inventory_balances")
    .select("id, quantity_on_hand, quantity_reserved")
    .eq("variant_id", variantId)
    .eq("location_id", location.id)
    .maybeSingle();

  if (balanceError) {
    throw new Error(`Failed to load variant balance for adjustment: ${balanceError.message}`);
  }

  const before = balance ? numberQuantity(balance.quantity_on_hand) : 0;
  const after = input.mode === "set_to" ? input.quantity : before + input.quantity;
  if (after < 0) {
    throw new Error("Adjustment would make inventory negative.");
  }

  const delta = after - before;
  if (delta === 0) {
    return {
      variantId,
      productId: Number(variant.product_id),
      quantityBefore: before,
      quantityAfter: after,
      quantityDelta: 0,
      alreadyProcessed: false,
      noChange: true,
    };
  }

  const reserved = balance ? numberQuantity(balance.quantity_reserved) : 0;
  const nextReserved = Math.min(reserved, after);
  if (balance) {
    const { error: updateBalanceError } = await supabase
      .from("inventory_balances")
      .update({
        quantity_on_hand: after,
        quantity_reserved: nextReserved,
        updated_at: new Date().toISOString(),
      })
      .eq("id", balance.id);

    if (updateBalanceError) {
      throw new Error(`Failed to update inventory balance: ${updateBalanceError.message}`);
    }
  } else {
    const { error: insertBalanceError } = await supabase.from("inventory_balances").insert({
      variant_id: variantId,
      location_id: location.id,
      quantity_on_hand: after,
      quantity_reserved: 0,
      updated_at: new Date().toISOString(),
    });

    if (insertBalanceError) {
      throw new Error(`Failed to create inventory balance: ${insertBalanceError.message}`);
    }
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    variant_id: variantId,
    location_id: location.id,
    movement_type: "manual_adjustment",
    quantity_delta: delta,
    quantity_before: before,
    quantity_after: after,
    reason,
    source_type: "admin_inventory_adjustment",
    source_id: variantId,
    idempotency_key: idempotencyKey,
    created_by: input.createdBy || "admin",
  });

  if (movementError) {
    throw new Error(`Failed to write inventory adjustment movement: ${movementError.message}`);
  }

  let legacySyncWarning: string | undefined;
  try {
    await syncLegacyStockFromErp(Number(variant.product_id));
  } catch (error) {
    legacySyncWarning =
      error instanceof Error ? error.message : "Failed to sync ERP stock back to legacy product fields.";
  }

  return {
    variantId,
    productId: Number(variant.product_id),
    quantityBefore: before,
    quantityAfter: after,
    quantityDelta: delta,
    alreadyProcessed: false,
    noChange: false,
    legacySyncWarning,
  };
}
