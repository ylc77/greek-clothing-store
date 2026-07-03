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

export async function syncProductInventoryFromLegacy() {
  throw new Error("syncProductInventoryFromLegacy is not implemented in Phase 1.5-A.");
}
