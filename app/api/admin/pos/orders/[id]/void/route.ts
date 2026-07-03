import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
import { getMainInventoryLocation, syncLegacyStockFromErp } from "@/lib/erp-inventory";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type VoidBody = {
  reason?: unknown;
  clientRequestId?: unknown;
};

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total: number | string;
  currency: string;
  voided_at: string | null;
};

type OrderItemRow = {
  id: string;
  product_id: number | string;
  variant_id: string;
  product_sku: string;
  variant_sku: string;
  quantity: number | string;
};

type BalanceRow = {
  id: string;
  variant_id: string;
  quantity_on_hand: number | string | null;
  quantity_reserved: number | string | null;
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
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function logVoidError(context: string, error: unknown, extra?: Record<string, unknown>) {
  const details =
    error && typeof error === "object"
      ? {
          message: "message" in error ? String((error as { message?: unknown }).message || "") : "",
          code: "code" in error ? String((error as { code?: unknown }).code || "") : "",
        }
      : { message: String(error || "") };

  console.error(`[POS void] ${context}`, { ...details, ...extra });
}

async function markOrderVoided(supabase: any, orderId: string) {
  const now = new Date().toISOString();
  const { error: orderError } = await supabase
    .from("sales_orders")
    .update({
      status: "voided",
      payment_status: "voided",
      voided_at: now,
      updated_at: now,
    })
    .eq("id", orderId);

  if (orderError) {
    throw new Error(`Failed to mark POS order as voided: ${orderError.message}`);
  }

  const { error: paymentError } = await supabase
    .from("payments")
    .update({ status: "voided" })
    .eq("order_id", orderId);

  if (paymentError) {
    throw new Error(`Failed to mark POS payments as voided: ${paymentError.message}`);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauthorized();

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const { id: orderId } = await context.params;
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as VoidBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const reason = text(body.reason);
  const clientRequestId = text(body.clientRequestId);
  if (reason.length < 3) {
    return NextResponse.json({ error: "作废原因必填，至少 3 个字符。" }, { status: 400 });
  }
  if (!clientRequestId) {
    return NextResponse.json({ error: "clientRequestId is required." }, { status: 400 });
  }

  try {
    const { data: order, error: orderError } = await (supabase as any)
      .from("sales_orders")
      .select("id, order_number, status, payment_status, total, currency, voided_at")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      logVoidError("load order failed", orderError, { orderId });
      return NextResponse.json({ error: "Failed to load POS order." }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "POS order was not found." }, { status: 404 });
    }

    const orderRow = order as OrderRow;
    if (orderRow.status === "voided") {
      return NextResponse.json({
        ok: true,
        alreadyProcessed: true,
        message: "该订单已作废。",
        order: {
          id: orderRow.id,
          order_number: orderRow.order_number,
          status: orderRow.status,
          payment_status: orderRow.payment_status,
          total: money(orderRow.total),
          currency: orderRow.currency,
          voided_at: orderRow.voided_at,
        },
      });
    }
    if (orderRow.status === "refunded") {
      return NextResponse.json({ error: "该订单已退款，不能再作废。" }, { status: 409 });
    }
    if (orderRow.status !== "completed") {
      return NextResponse.json({ error: "只有 completed 状态的订单可以作废。" }, { status: 409 });
    }

    const { data: existingVoidMovement, error: existingVoidError } = await (supabase as any)
      .from("stock_movements")
      .select("id")
      .eq("source_type", "pos_void")
      .eq("source_id", orderId)
      .limit(1)
      .maybeSingle();

    if (existingVoidError) {
      logVoidError("check existing void movement failed", existingVoidError, { orderId });
      return NextResponse.json({ error: "Failed to check whether this POS order was already voided." }, { status: 500 });
    }

    if (existingVoidMovement) {
      await markOrderVoided(supabase as any, orderId);
      return NextResponse.json({
        ok: true,
        alreadyProcessed: true,
        message: "该订单已作废，库存不会重复加回。",
        order: {
          id: orderRow.id,
          order_number: orderRow.order_number,
          status: "voided",
          payment_status: "voided",
          total: money(orderRow.total),
          currency: orderRow.currency,
        },
      });
    }

    const { data: items, error: itemsError } = await (supabase as any)
      .from("sales_order_items")
      .select("id, product_id, variant_id, product_sku, variant_sku, quantity")
      .eq("order_id", orderId);

    if (itemsError) {
      logVoidError("load order items failed", itemsError, { orderId });
      return NextResponse.json({ error: "Failed to load POS order items." }, { status: 500 });
    }

    const orderItems = (items || []) as OrderItemRow[];
    if (orderItems.length === 0) {
      return NextResponse.json({ error: "该订单没有商品明细，不能自动作废。" }, { status: 409 });
    }

    const location = await getMainInventoryLocation();
    const variantIds = Array.from(new Set(orderItems.map((item) => item.variant_id)));
    const { data: balances, error: balancesError } = await (supabase as any)
      .from("inventory_balances")
      .select("id, variant_id, quantity_on_hand, quantity_reserved")
      .eq("location_id", location.id)
      .in("variant_id", variantIds);

    if (balancesError) {
      logVoidError("load balances failed", balancesError, { orderId });
      return NextResponse.json({ error: "Failed to load ERP inventory balances." }, { status: 500 });
    }

    const balanceByVariant = new Map<string, BalanceRow>();
    for (const balance of (balances || []) as BalanceRow[]) {
      balanceByVariant.set(balance.variant_id, balance);
    }

    const quantitiesByVariant = new Map<
      string,
      { quantity: number; productId: number; productSku: string; variantSku: string }
    >();
    for (const item of orderItems) {
      const qty = quantity(item.quantity);
      const current = quantitiesByVariant.get(item.variant_id);
      if (current) {
        current.quantity += qty;
      } else {
        quantitiesByVariant.set(item.variant_id, {
          quantity: qty,
          productId: Number(item.product_id),
          productSku: text(item.product_sku),
          variantSku: text(item.variant_sku),
        });
      }
    }

    const idempotencyPrefix = `pos_void:${clientRequestId}:${orderId}`;
    const restoredItems: Array<{
      variant_id: string;
      variant_sku: string;
      quantity_before: number;
      quantity_after: number;
      quantity_delta: number;
    }> = [];
    const affectedProductIds = new Set<number>();
    const affectedSkus = new Set<string>();

    for (const [variantId, item] of quantitiesByVariant.entries()) {
      if (item.quantity <= 0) continue;

      const balance = balanceByVariant.get(variantId);
      if (!balance) {
        return NextResponse.json(
          {
            error: "作废失败：该订单商品缺少 ERP 库存余额，需要人工对账。",
            variantId,
            variant_sku: item.variantSku,
          },
          { status: 409 },
        );
      }

      const movementKey = `${idempotencyPrefix}:${variantId}`;
      const { data: existingMovement, error: movementReadError } = await (supabase as any)
        .from("stock_movements")
        .select("id")
        .eq("idempotency_key", movementKey)
        .maybeSingle();

      if (movementReadError) {
        logVoidError("check movement idempotency failed", movementReadError, { orderId, variantId });
        return NextResponse.json({ error: "Failed to check POS void idempotency." }, { status: 500 });
      }
      if (existingMovement) continue;

      const before = quantity(balance.quantity_on_hand);
      const reserved = quantity(balance.quantity_reserved);
      const after = before + item.quantity;

      const { data: updatedBalance, error: updateBalanceError } = await (supabase as any)
        .from("inventory_balances")
        .update({
          quantity_on_hand: after,
          updated_at: new Date().toISOString(),
        })
        .eq("id", balance.id)
        .eq("quantity_on_hand", before)
        .eq("quantity_reserved", reserved)
        .select("id")
        .maybeSingle();

      if (updateBalanceError || !updatedBalance) {
        if (updateBalanceError) {
          logVoidError("restore inventory balance failed", updateBalanceError, { orderId, variantId });
        }
        return NextResponse.json(
          {
            error: "作废失败：库存余额在操作过程中变化，请重新打开订单并人工对账。",
            orderId,
            variantId,
            variant_sku: item.variantSku,
          },
          { status: 409 },
        );
      }

      const { error: movementError } = await (supabase as any).from("stock_movements").insert({
        variant_id: variantId,
        location_id: location.id,
        movement_type: "return",
        quantity_delta: item.quantity,
        quantity_before: before,
        quantity_after: after,
        reason,
        source_type: "pos_void",
        source_id: orderId,
        idempotency_key: movementKey,
        created_by: "admin",
      });

      if (movementError) {
        logVoidError("write void movement failed", movementError, { orderId, variantId });
        return NextResponse.json(
          {
            error: "订单库存已加回，但库存流水写入失败，需要人工对账。",
            orderId,
            requiresManualReconciliation: true,
          },
          { status: 500 },
        );
      }

      restoredItems.push({
        variant_id: variantId,
        variant_sku: item.variantSku,
        quantity_before: before,
        quantity_after: after,
        quantity_delta: item.quantity,
      });
      affectedProductIds.add(item.productId);
      affectedSkus.add(item.productSku);
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

    await markOrderVoided(supabase as any, orderId);
    for (const sku of affectedSkus) {
      invalidateProductsCache(sku || null);
    }

    return NextResponse.json({
      ok: true,
      alreadyProcessed: false,
      message: "订单已作废，库存已加回。",
      order: {
        id: orderRow.id,
        order_number: orderRow.order_number,
        status: "voided",
        payment_status: "voided",
        total: money(orderRow.total),
        currency: orderRow.currency,
      },
      restoredItems,
      legacySyncWarning: legacySyncWarnings.length > 0 ? legacySyncWarnings : undefined,
    });
  } catch (error) {
    logVoidError("unexpected void failure", error, { orderId });
    return NextResponse.json({ error: "Failed to void POS order." }, { status: 500 });
  }
}
