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
