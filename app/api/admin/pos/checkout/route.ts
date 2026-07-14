import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, adminHasPermission, getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { getMainInventoryLocation, syncLegacyStockFromErp } from "@/lib/erp-inventory";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getPublishedLegalSettings } from "@/lib/legal-settings";

type CheckoutItemInput = {
  variantId?: unknown;
  quantity?: unknown;
};

type CheckoutBody = {
  clientRequestId?: unknown;
  paymentMethod?: unknown;
  items?: unknown;
  discountTotal?: unknown;
  notes?: unknown;
  dryRun?: unknown;
};

type VariantRow = {
  id: string;
  product_id: number | string;
  variant_sku: string | null;
  barcode: string | null;
  size: string | null;
  color: string | null;
  price: number | string | null;
  active: boolean | null;
};

type ProductRow = {
  id: number | string;
  sku: string | null;
  name_cn: string | null;
  name_en: string | null;
  name_gr: string | null;
  price: number | string | null;
  is_active: boolean | null;
};

type BalanceRow = {
  id: string;
  variant_id: string;
  location_id: string;
  quantity_on_hand: number | string | null;
  quantity_reserved: number | string | null;
};

type ExistingOrder = {
  id: string;
  order_number: string;
  subtotal: number | string;
  discount_total: number | string;
  total: number | string;
  payment_status: string;
  status: string;
  created_at: string;
};

type OrderItemInsert = {
  order_id: string;
  product_id: number;
  variant_id: string;
  product_sku: string;
  variant_sku: string;
  barcode: string | null;
  name: string;
  size: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
  discount_total: number;
  line_total: number;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function quantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function money(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function productName(product: ProductRow) {
  return (
    text(product.name_cn) ||
    text(product.name_en) ||
    text(product.name_gr) ||
    text(product.sku)
  );
}

function logCheckoutError(context: string, error: unknown, extra?: Record<string, unknown>) {
  const details =
    error && typeof error === "object"
      ? {
          message: "message" in error ? String((error as { message?: unknown }).message || "") : "",
          code: "code" in error ? String((error as { code?: unknown }).code || "") : "",
        }
      : { message: String(error || "") };

  console.error(`[POS checkout] ${context}`, { ...details, ...extra });
}

function orderNumber() {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `POS-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function isPaymentMethod(value: unknown): value is "cash" | "card" | "other" {
  return value === "cash" || value === "card" || value === "other";
}

function usePosRpc() {
  return process.env.USE_POS_RPC === "true";
}

function posRpcRequiredResponse() {
  return NextResponse.json(
    {
      error: "POS transactional RPC is required. Set USE_POS_RPC=true and deploy the POS RPC migrations before checkout.",
      code: "POS_RPC_REQUIRED",
      requiresConfiguration: true,
    },
    { status: 503 },
  );
}

function checkoutErrorStatus(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("insufficient stock")) return 409;
  if (normalized.includes("inactive")) return 400;
  if (normalized.includes("required") || normalized.includes("must be")) return 400;
  return 503;
}

function normalizeItems(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items is required.");
  }

  const quantitiesByVariant = new Map<string, number>();
  for (const item of items as CheckoutItemInput[]) {
    const variantId = text(item?.variantId);
    const qty = Number(item?.quantity);
    if (!variantId) throw new Error("Each item must include variantId.");
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Each item quantity must be a positive integer.");
    }
    quantitiesByVariant.set(variantId, (quantitiesByVariant.get(variantId) || 0) + qty);
  }

  return Array.from(quantitiesByVariant.entries()).map(([variantId, qty]) => ({
    variantId,
    quantity: qty,
  }));
}

async function loadExistingOrder(supabase: any, idempotencyKey: string) {
  const { data: order, error: orderError } = await supabase
    .from("sales_orders")
    .select("id, order_number, subtotal, discount_total, total, payment_status, status, created_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (orderError) {
    logCheckoutError("check checkout idempotency failed", orderError, { idempotencyKey });
    throw new Error("Failed to check whether this POS checkout was already processed.");
  }
  if (!order) return null;

  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase
      .from("sales_order_items")
      .select("id, product_sku, variant_sku, name, size, color, quantity, unit_price, line_total")
      .eq("order_id", order.id),
    supabase
      .from("payments")
      .select("id, method, amount, status, created_at")
      .eq("order_id", order.id),
  ]);

  return {
    order: {
      id: order.id,
      order_number: order.order_number,
      subtotal: money(order.subtotal),
      discount_total: money(order.discount_total),
      total: money(order.total),
      payment_status: order.payment_status,
      status: order.status,
      created_at: order.created_at,
    },
    items: items || [],
    payments: payments || [],
  };
}

export async function POST(request: NextRequest) {
  const authContext = await getAdminAuthContextFromRequest(request);
  if (!adminHasPermission(authContext, "pos:checkout")) return unauthorized();
  if (!(await isFeatureEnabled("pos_checkout"))) return featureDisabledResponse("pos_checkout");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const payload = (await request.json().catch(() => null)) as CheckoutBody | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const clientRequestId = text(payload.clientRequestId);
  const notes = text(payload.notes);
  const dryRun = payload.dryRun === true;
  const posRpcEnabled = usePosRpc();
  if (!dryRun && !posRpcEnabled) return posRpcRequiredResponse();
  if (!clientRequestId) {
    return NextResponse.json({ error: "clientRequestId is required." }, { status: 400 });
  }
  if (!isPaymentMethod(payload.paymentMethod)) {
    return NextResponse.json(
      { error: "paymentMethod must be one of: cash, card, other." },
      { status: 400 },
    );
  }

  let itemsInput: Array<{ variantId: string; quantity: number }>;
  try {
    itemsInput = normalizeItems(payload.items);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid checkout items.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const discountTotal = money(payload.discountTotal || 0);
  const idempotencyKey = `pos_sale:${clientRequestId}`;
  const actor = adminActorFromContext(authContext!);

  try {
    const legalRecord = dryRun ? null : await getPublishedLegalSettings();
    const legalAcceptance = legalRecord?.currentVersion ? {
      legal_terms_version: legalRecord.currentVersion,
      privacy_policy_version: legalRecord.currentVersion,
      legal_accepted_at: new Date().toISOString(),
    } : {};
    if (posRpcEnabled && !dryRun) {
      const { data, error } = await (supabase as any).rpc("pos_checkout_rpc", {
        p_client_request_id: clientRequestId,
        p_payment_method: payload.paymentMethod,
        p_items: itemsInput.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        p_discount_total: discountTotal,
        p_notes: notes || null,
        p_created_by: actor,
        p_legal_terms_version: legalRecord?.currentVersion || null,
        p_privacy_policy_version: legalRecord?.currentVersion || null,
        p_legal_accepted_at: legalRecord?.currentVersion ? new Date().toISOString() : null,
      });

      if (error) {
        logCheckoutError("RPC checkout failed", error, { clientRequestId });
        const message = String(error.message || "Failed to complete POS checkout.");
        const status = checkoutErrorStatus(message);
        return NextResponse.json(
          {
            error: message,
            code: status === 503 ? "POS_RPC_UNAVAILABLE" : undefined,
            requiresConfiguration: status === 503,
          },
          { status },
        );
      }

      const result = data || {};
      const affectedSkus = Array.isArray(result.affected_skus) ? result.affected_skus : [];
      for (const sku of affectedSkus) {
        invalidateProductsCache(typeof sku === "string" ? sku : null);
      }

      return NextResponse.json({
        ok: true,
        rpc: true,
        alreadyProcessed: result.already_processed === true,
        order: result.order,
        items: result.items || [],
        payments: result.payments || [],
      });
    }

    const location = await getMainInventoryLocation();
    const variantIds = itemsInput.map((item) => item.variantId);
    const { data: variants, error: variantsError } = await (supabase as any)
      .from("product_variants")
      .select("id, product_id, variant_sku, barcode, size, color, price, active")
      .in("id", variantIds);

    if (variantsError) {
      logCheckoutError("load variants failed", variantsError);
      return NextResponse.json({ error: "Failed to load POS items." }, { status: 500 });
    }

    const variantRows = (variants || []) as VariantRow[];
    if (variantRows.length !== variantIds.length) {
      const foundIds = new Set(variantRows.map((variant) => variant.id));
      return NextResponse.json(
        {
          error: "One or more POS items were not found.",
          missingVariantIds: variantIds.filter((variantId) => !foundIds.has(variantId)),
        },
        { status: 400 },
      );
    }

    const productIds = Array.from(new Set(variantRows.map((variant) => Number(variant.product_id)).filter(Number.isFinite)));
    const { data: products, error: productsError } = await (supabase as any)
      .from("products")
      .select("id, sku, name_cn, name_en, name_gr, price, is_active")
      .in("id", productIds);

    if (productsError) {
      logCheckoutError("load products failed", productsError);
      return NextResponse.json({ error: "Failed to load POS product details." }, { status: 500 });
    }

    const productMap = new Map<number, ProductRow>();
    for (const product of (products || []) as ProductRow[]) {
      productMap.set(Number(product.id), product);
    }

    const { data: balances, error: balancesError } = await (supabase as any)
      .from("inventory_balances")
      .select("id, variant_id, location_id, quantity_on_hand, quantity_reserved")
      .eq("location_id", location.id)
      .in("variant_id", variantIds);

    if (balancesError) {
      logCheckoutError("load inventory balances failed", balancesError);
      return NextResponse.json({ error: "Failed to load POS inventory balances." }, { status: 500 });
    }

    const balanceMap = new Map<string, BalanceRow>();
    for (const balance of (balances || []) as BalanceRow[]) {
      balanceMap.set(String(balance.variant_id), balance);
    }

    const orderItems: OrderItemInsert[] = [];
    const balanceChanges: Array<{
      variant: VariantRow;
      product: ProductRow;
      balance: BalanceRow;
      quantity: number;
      quantityBefore: number;
      quantityReserved: number;
      quantityAfter: number;
    }> = [];

    for (const item of itemsInput) {
      const variant = variantRows.find((row) => row.id === item.variantId);
      if (!variant || variant.active === false) {
        return NextResponse.json(
          {
            error: "POS variant is inactive or missing.",
            variantId: item.variantId,
            variant_sku: variant?.variant_sku || null,
          },
          { status: 400 },
        );
      }

      const product = productMap.get(Number(variant.product_id));
      if (!product || product.is_active === false) {
        return NextResponse.json(
          {
            error: "Product is inactive and cannot be sold.",
            sku: product?.sku || null,
            variant_sku: variant.variant_sku,
          },
          { status: 400 },
        );
      }

      const balance = balanceMap.get(variant.id);
      if (!balance) {
        return NextResponse.json(
          {
            error: "Inventory balance is missing for this variant.",
            variantId: variant.id,
            variant_sku: variant.variant_sku,
          },
          { status: 400 },
        );
      }

      const onHand = quantity(balance.quantity_on_hand);
      const reserved = quantity(balance.quantity_reserved);
      const available = Math.max(0, onHand - reserved);
      if (available < item.quantity) {
        return NextResponse.json(
          {
            error: "Insufficient stock for POS checkout.",
            variantId: variant.id,
            variant_sku: variant.variant_sku,
            product_sku: product.sku,
            requested: item.quantity,
            available,
          },
          { status: 409 },
        );
      }

      const unitPrice = money(variant.price ?? product.price);
      const lineTotal = money(unitPrice * item.quantity);
      orderItems.push({
        order_id: "",
        product_id: Number(product.id),
        variant_id: variant.id,
        product_sku: text(product.sku),
        variant_sku: text(variant.variant_sku),
        barcode: text(variant.barcode) || null,
        name: productName(product),
        size: text(variant.size) || null,
        color: text(variant.color) || null,
        quantity: item.quantity,
        unit_price: unitPrice,
        discount_total: 0,
        line_total: lineTotal,
      });
      balanceChanges.push({
        variant,
        product,
        balance,
        quantity: item.quantity,
        quantityBefore: onHand,
        quantityReserved: reserved,
        quantityAfter: onHand - item.quantity,
      });
    }

    const subtotal = money(orderItems.reduce((sum, item) => sum + item.line_total, 0));
    if (discountTotal > subtotal) {
      return NextResponse.json({ error: "discountTotal cannot be greater than subtotal." }, { status: 400 });
    }
    const total = money(subtotal - discountTotal);

    const previewItems = orderItems.map((item, index) => {
      const change = balanceChanges[index];
      return {
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_sku: item.product_sku,
        variant_sku: item.variant_sku,
        barcode: item.barcode,
        name: item.name,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_total: item.discount_total,
        line_total: item.line_total,
        quantity_on_hand: change.quantityBefore,
        quantity_reserved: change.quantityReserved,
        quantity_available: Math.max(0, change.quantityBefore - change.quantityReserved),
        quantity_after: change.quantityAfter,
      };
    });

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        alreadyProcessed: false,
        paymentMethod: payload.paymentMethod,
        stockCheck: {
          ok: true,
          itemCount: previewItems.length,
        },
        items: previewItems,
        subtotal,
        discount_total: discountTotal,
        total,
      });
    }

    // Historical audit reference only: every possible runtime branch has
    // already returned above. Formal writes can only reach the RPC branch.
    const existingOrder = await loadExistingOrder(supabase as any, idempotencyKey);
    if (existingOrder) {
      return NextResponse.json({
        ok: true,
        alreadyProcessed: true,
        ...existingOrder,
      });
    }

    let order: ExistingOrder | null = null;
    let orderInsertError: { message: string; code?: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await (supabase as any)
        .from("sales_orders")
        .insert({
          order_number: orderNumber(),
          status: "completed",
          source: "pos",
          subtotal,
          discount_total: discountTotal,
          total,
          currency: "EUR",
          payment_status: "paid",
          idempotency_key: idempotencyKey,
          created_by: "admin",
          notes: notes || null,
          completed_at: new Date().toISOString(),
          ...legalAcceptance,
        })
        .select("id, order_number, subtotal, discount_total, total, payment_status, status, created_at")
        .single();

      if (!error) {
        order = data as ExistingOrder;
        break;
      }

      orderInsertError = error;
      if (error.code === "23505") {
        const existing = await loadExistingOrder(supabase as any, idempotencyKey);
        if (existing) {
          return NextResponse.json({ ok: true, alreadyProcessed: true, ...existing });
        }
      } else {
        logCheckoutError("create sales order failed", error, { idempotencyKey });
        break;
      }
    }

    if (!order) {
      logCheckoutError("create sales order failed", orderInsertError, { idempotencyKey });
      return NextResponse.json({ error: "Failed to create POS order." }, { status: 500 });
    }

    const itemsToInsert = orderItems.map((item) => ({ ...item, order_id: order!.id }));
    const { data: insertedItems, error: itemsError } = await (supabase as any)
      .from("sales_order_items")
      .insert(itemsToInsert)
      .select("id, product_sku, variant_sku, name, size, color, quantity, unit_price, line_total");

    if (itemsError) {
      logCheckoutError("create sales order items failed", itemsError, { orderId: order.id });
      return NextResponse.json(
        {
          error: "POS order was created but order items failed. Please reconcile this order manually.",
          orderId: order.id,
          requiresManualReconciliation: true,
        },
        { status: 500 },
      );
    }

    const { data: payment, error: paymentError } = await (supabase as any)
      .from("payments")
      .insert({
        order_id: order.id,
        method: payload.paymentMethod,
        amount: total,
        currency: "EUR",
        status: "paid",
      })
      .select("id, method, amount, status, created_at")
      .single();

    if (paymentError) {
      logCheckoutError("create payment failed", paymentError, { orderId: order.id });
      return NextResponse.json(
        {
          error: "POS order was created but payment failed. Please reconcile this order manually.",
          orderId: order.id,
          requiresManualReconciliation: true,
        },
        { status: 500 },
      );
    }

    const affectedProductIds = new Set<number>();
    const affectedSkus = new Set<string>();
    for (const change of balanceChanges) {
      const { data: updatedBalance, error: updateBalanceError } = await (supabase as any)
        .from("inventory_balances")
        .update({
          quantity_on_hand: change.quantityAfter,
          updated_at: new Date().toISOString(),
        })
        .eq("id", change.balance.id)
        .eq("quantity_on_hand", change.quantityBefore)
        .eq("quantity_reserved", change.quantityReserved)
        .select("id")
        .maybeSingle();

      if (updateBalanceError || !updatedBalance) {
        if (updateBalanceError) {
          logCheckoutError("update inventory balance failed", updateBalanceError, {
            orderId: order.id,
            variantId: change.variant.id,
          });
        }
        return NextResponse.json(
          {
            error: "POS order was created but inventory changed before checkout completed.",
            orderId: order.id,
            variantId: change.variant.id,
            variant_sku: change.variant.variant_sku,
            requiresManualReconciliation: true,
          },
          { status: 409 },
        );
      }

      const movementKey = `${idempotencyKey}:${change.variant.id}`;
      const { error: movementError } = await (supabase as any).from("stock_movements").insert({
        variant_id: change.variant.id,
        location_id: location.id,
        movement_type: "sale",
        quantity_delta: 0 - change.quantity,
        quantity_before: change.quantityBefore,
        quantity_after: change.quantityAfter,
        reason: "POS sale",
        source_type: "pos_sale",
        source_id: order.id,
        idempotency_key: movementKey,
        created_by: "admin",
      });

      if (movementError) {
        logCheckoutError("write stock movement failed", movementError, {
          orderId: order.id,
          variantId: change.variant.id,
        });
        return NextResponse.json(
          {
            error: "POS order was created but stock movement failed. Please reconcile this order manually.",
            orderId: order.id,
            requiresManualReconciliation: true,
          },
          { status: 500 },
        );
      }

      affectedProductIds.add(Number(change.product.id));
      affectedSkus.add(text(change.product.sku));
    }

    const legacySyncWarnings: string[] = [];
    for (const productId of affectedProductIds) {
      try {
        await syncLegacyStockFromErp(productId);
      } catch (error) {
        legacySyncWarnings.push(
          error instanceof Error
            ? `Product ${productId}: ${error.message}`
            : `Product ${productId}: legacy stock sync failed.`,
        );
      }
    }

    for (const sku of affectedSkus) {
      invalidateProductsCache(sku || null);
    }

    return NextResponse.json({
      ok: true,
      alreadyProcessed: false,
      order: {
        id: order.id,
        order_number: order.order_number,
        subtotal,
        discount_total: discountTotal,
        total,
        payment_status: order.payment_status,
        status: order.status,
        created_at: order.created_at,
      },
      items: insertedItems || [],
      payments: payment ? [payment] : [],
      legacySyncWarning: legacySyncWarnings.length > 0 ? legacySyncWarnings : undefined,
    });
  } catch (error) {
    logCheckoutError("unexpected checkout failure", error);
    return NextResponse.json({ error: "Failed to complete POS checkout." }, { status: 500 });
  }
}
