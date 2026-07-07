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
  source: string;
  total: number | string;
  currency: string;
  created_at: string;
  completed_at: string | null;
  created_by: string | null;
  notes: string | null;
};

type PaymentRow = {
  order_id: string;
  method: string;
  status: string;
};

type ItemRow = {
  order_id: string;
  product_sku: string;
  variant_sku: string;
  name: string;
  quantity: number | string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function clean(value: string | null) {
  return (value || "").trim();
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function intParam(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function dateRange(value: string | null) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (value === "today") return { start, end };
  if (value === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
    return { start, end };
  }
  if (value === "last7days") {
    start.setDate(start.getDate() - 6);
    return { start, end };
  }
  return null;
}

function includesQuery(value: unknown, q: string) {
  return String(value || "").toLowerCase().includes(q);
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "pos:read"))) return unauthorized();
  if (!(await isFeatureEnabled("pos_orders"))) return featureDisabledResponse("pos_orders");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const url = new URL(request.url);
  const q = clean(url.searchParams.get("q")).toLowerCase();
  const status = clean(url.searchParams.get("status")) || "all";
  const paymentMethod = clean(url.searchParams.get("paymentMethod")) || "all";
  const range = clean(url.searchParams.get("dateRange")) || "today";
  const limit = intParam(url.searchParams.get("limit"), 50, 200);
  const offset = intParam(url.searchParams.get("offset"), 0, 10_000);

  try {
    let query = (supabase as any)
      .from("sales_orders")
      .select("id, order_number, status, payment_status, source, total, currency, created_at, completed_at, created_by, notes")
      .eq("source", "pos")
      .order("created_at", { ascending: false })
      .limit(500);

    if (status !== "all") query = query.eq("status", status);
    const selectedRange = dateRange(range);
    if (selectedRange) {
      query = query.gte("created_at", selectedRange.start.toISOString()).lte("created_at", selectedRange.end.toISOString());
    }

    const { data: ordersData, error: ordersError } = await query;
    if (ordersError) {
      return NextResponse.json({ error: "Failed to load POS orders." }, { status: 500 });
    }

    const orders = (ordersData || []) as OrderRow[];
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) return NextResponse.json({ ok: true, orders: [], total: 0, limit, offset });

    const [{ data: paymentsData, error: paymentsError }, { data: itemsData, error: itemsError }] = await Promise.all([
      (supabase as any)
        .from("payments")
        .select("order_id, method, status")
        .in("order_id", orderIds),
      (supabase as any)
        .from("sales_order_items")
        .select("order_id, product_sku, variant_sku, name, quantity")
        .in("order_id", orderIds),
    ]);

    if (paymentsError || itemsError) {
      return NextResponse.json({ error: "Failed to load POS order relations." }, { status: 500 });
    }

    const payments = (paymentsData || []) as PaymentRow[];
    const items = (itemsData || []) as ItemRow[];
    const paymentByOrder = new Map<string, PaymentRow>();
    for (const payment of payments) {
      if (!paymentByOrder.has(payment.order_id)) paymentByOrder.set(payment.order_id, payment);
    }

    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const item of items) {
      const current = itemsByOrder.get(item.order_id) || [];
      current.push(item);
      itemsByOrder.set(item.order_id, current);
    }

    const filtered = orders.filter((order) => {
      const payment = paymentByOrder.get(order.id);
      if (paymentMethod !== "all" && payment?.method !== paymentMethod) return false;
      if (!q) return true;

      if (includesQuery(order.order_number, q)) return true;
      return (itemsByOrder.get(order.id) || []).some((item) =>
        includesQuery(item.product_sku, q) ||
        includesQuery(item.variant_sku, q) ||
        includesQuery(item.name, q)
      );
    });

    const page = filtered.slice(offset, offset + limit);
    return NextResponse.json({
      ok: true,
      orders: page.map((order) => {
        const orderItems = itemsByOrder.get(order.id) || [];
        const payment = paymentByOrder.get(order.id);
        return {
          id: order.id,
          order_number: order.order_number,
          status: order.status,
          payment_status: order.payment_status,
          source: order.source,
          total: money(order.total),
          currency: order.currency,
          created_at: order.created_at,
          completed_at: order.completed_at,
          payment_method: payment?.method || null,
          payment_method_status: payment?.status || null,
          items_count: orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          created_by: order.created_by,
          notes: order.notes,
        };
      }),
      total: filtered.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[POS orders] failed", error);
    return NextResponse.json({ error: "Failed to load POS orders." }, { status: 500 });
  }
}
