import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total: number | string;
  subtotal: number | string;
  discount_total: number | string;
  currency: string;
  created_at: string;
  voided_at: string | null;
};

type PaymentRow = {
  order_id: string;
  method: string;
  amount: number | string;
  status: string;
};

type ItemRow = {
  order_id: string;
  product_sku: string;
  variant_sku: string;
  name: string;
  quantity: number | string;
  line_total: number | string;
};

type MovementRow = {
  source_id: string | null;
  source_type: string | null;
  movement_type: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function localDayRange(dateValue: string | null, timezoneOffsetMinutesValue: string | null) {
  const now = new Date();
  const fallbackDate = now.toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue || "") ? String(dateValue) : fallbackDate;
  const offset = Number(timezoneOffsetMinutesValue);
  const timezoneOffsetMinutes = Number.isFinite(offset) ? Math.trunc(offset) : now.getTimezoneOffset();
  const [year, month, day] = date.split("-").map(Number);
  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + timezoneOffsetMinutes * 60_000;
  const endUtcMs = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) + timezoneOffsetMinutes * 60_000;
  return {
    date,
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
    timezoneOffsetMinutes,
  };
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "pos:read"))) return unauthorized();
  if (!(await isFeatureEnabled("pos_reports"))) return featureDisabledResponse("pos_reports");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const url = new URL(request.url);
  const range = localDayRange(url.searchParams.get("date"), url.searchParams.get("timezoneOffsetMinutes"));

  try {
    const { data: ordersData, error: ordersError } = await (supabase as any)
      .from("sales_orders")
      .select("id, order_number, status, payment_status, total, subtotal, discount_total, currency, created_at, voided_at")
      .eq("source", "pos")
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .order("created_at", { ascending: true });

    if (ordersError) {
      return NextResponse.json({ error: "Failed to load POS daily orders." }, { status: 500 });
    }

    const orders = (ordersData || []) as OrderRow[];
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) {
      return NextResponse.json({
        ok: true,
        date: range.date,
        range: { start: range.start.toISOString(), end: range.end.toISOString(), timezoneOffsetMinutes: range.timezoneOffsetMinutes },
        summary: {
          ordersTotal: 0,
          completedOrders: 0,
          voidedOrders: 0,
          refundedOrders: 0,
          grossSales: 0,
          voidedTotal: 0,
          discountTotal: 0,
          netSales: 0,
          itemsSold: 0,
        },
        paymentMethods: [],
        topItems: [],
        orders: [],
        health: { missingPayments: 0, missingItems: 0, missingSaleMovements: 0, missingVoidMovements: 0 },
      });
    }

    const [{ data: paymentsData, error: paymentsError }, { data: itemsData, error: itemsError }, { data: movementsData, error: movementsError }] =
      await Promise.all([
        (supabase as any).from("payments").select("order_id, method, amount, status").in("order_id", orderIds),
        (supabase as any).from("sales_order_items").select("order_id, product_sku, variant_sku, name, quantity, line_total").in("order_id", orderIds),
        (supabase as any).from("stock_movements").select("source_id, source_type, movement_type").in("source_id", orderIds),
      ]);

    if (paymentsError || itemsError || movementsError) {
      return NextResponse.json({ error: "Failed to load POS daily relations." }, { status: 500 });
    }

    const payments = (paymentsData || []) as PaymentRow[];
    const items = (itemsData || []) as ItemRow[];
    const movements = (movementsData || []) as MovementRow[];
    const paymentsByOrder = new Map<string, PaymentRow[]>();
    const itemsByOrder = new Map<string, ItemRow[]>();
    const movementsByOrder = new Map<string, MovementRow[]>();

    for (const payment of payments) paymentsByOrder.set(payment.order_id, [...(paymentsByOrder.get(payment.order_id) || []), payment]);
    for (const item of items) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) || []), item]);
    for (const movement of movements) {
      if (!movement.source_id) continue;
      movementsByOrder.set(movement.source_id, [...(movementsByOrder.get(movement.source_id) || []), movement]);
    }

    const paymentTotals = new Map<string, { method: string; amount: number; count: number }>();
    const topItems = new Map<string, { product_sku: string; variant_sku: string; name: string; quantity: number; total: number }>();

    let grossSales = 0;
    let voidedTotal = 0;
    let discountTotal = 0;
    let itemsSold = 0;
    let completedOrders = 0;
    let voidedOrders = 0;
    let refundedOrders = 0;
    let missingPayments = 0;
    let missingItems = 0;
    let missingSaleMovements = 0;
    let missingVoidMovements = 0;

    for (const order of orders) {
      const orderPayments = paymentsByOrder.get(order.id) || [];
      const orderItems = itemsByOrder.get(order.id) || [];
      const orderMovements = movementsByOrder.get(order.id) || [];
      if (orderPayments.length === 0) missingPayments++;
      if (orderItems.length === 0) missingItems++;

      if (order.status === "completed") {
        completedOrders++;
        grossSales += money(order.total);
        discountTotal += money(order.discount_total);
        if (!orderMovements.some((movement) => movement.movement_type === "sale" && movement.source_type === "pos_sale")) {
          missingSaleMovements++;
        }
        for (const item of orderItems) {
          const qty = integer(item.quantity);
          const key = item.variant_sku || item.product_sku;
          const current = topItems.get(key) || {
            product_sku: item.product_sku,
            variant_sku: item.variant_sku,
            name: item.name,
            quantity: 0,
            total: 0,
          };
          current.quantity += qty;
          current.total += money(item.line_total);
          topItems.set(key, current);
          itemsSold += qty;
        }
        for (const payment of orderPayments) {
          if (payment.status !== "paid") continue;
          const current = paymentTotals.get(payment.method) || { method: payment.method, amount: 0, count: 0 };
          current.amount += money(payment.amount);
          current.count += 1;
          paymentTotals.set(payment.method, current);
        }
      }

      if (order.status === "voided") {
        voidedOrders++;
        voidedTotal += money(order.total);
        if (!orderMovements.some((movement) => movement.movement_type === "return" && movement.source_type === "pos_void")) {
          missingVoidMovements++;
        }
      }

      if (order.status === "refunded") refundedOrders++;
    }

    return NextResponse.json({
      ok: true,
      date: range.date,
      range: { start: range.start.toISOString(), end: range.end.toISOString(), timezoneOffsetMinutes: range.timezoneOffsetMinutes },
      summary: {
        ordersTotal: orders.length,
        completedOrders,
        voidedOrders,
        refundedOrders,
        grossSales: money(grossSales),
        voidedTotal: money(voidedTotal),
        discountTotal: money(discountTotal),
        netSales: money(grossSales),
        itemsSold,
      },
      paymentMethods: Array.from(paymentTotals.values()).map((item) => ({ ...item, amount: money(item.amount) })),
      topItems: Array.from(topItems.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 20).map((item) => ({ ...item, total: money(item.total) })),
      orders: orders.map((order) => ({
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        total: money(order.total),
        currency: order.currency,
        created_at: order.created_at,
        payments_count: (paymentsByOrder.get(order.id) || []).length,
        items_count: (itemsByOrder.get(order.id) || []).reduce((sum, item) => sum + integer(item.quantity), 0),
      })),
      health: { missingPayments, missingItems, missingSaleMovements, missingVoidMovements },
    });
  } catch (error) {
    console.error("[POS daily report] failed", error);
    return NextResponse.json({ error: "Failed to load POS daily report." }, { status: 500 });
  }
}
