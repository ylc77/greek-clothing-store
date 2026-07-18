import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 503 });
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await authorizeAdminRequest(request, "pos:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("pos_orders"))) return featureDisabledResponse("pos_orders");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Order id is required." }, { status: 400 });
  }

  try {
    const { data: order, error: orderError } = await (supabase as any)
      .from("sales_orders")
      .select("id, order_number, status, payment_status, source, subtotal, discount_total, total, currency, created_by, notes, created_at, updated_at, completed_at, voided_at, refunded_at")
      .eq("id", id)
      .maybeSingle();

    if (orderError) {
      return NextResponse.json({ error: "Failed to load POS order." }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "POS order was not found." }, { status: 404 });
    }

    const [{ data: items, error: itemsError }, { data: payments, error: paymentsError }, { data: movements, error: movementsError }] = await Promise.all([
      (supabase as any)
        .from("sales_order_items")
        .select("id, product_id, variant_id, product_sku, variant_sku, barcode, name, name_en, name_gr, size, color, quantity, unit_price, discount_total, line_total, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true }),
      (supabase as any)
        .from("payments")
        .select("id, method, amount, currency, status, provider, provider_reference, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true }),
      (supabase as any)
        .from("stock_movements")
        .select("id, variant_id, movement_type, quantity_before, quantity_after, quantity_delta, reason, source_type, source_id, created_by, created_at")
        .eq("source_id", id)
        .order("created_at", { ascending: true }),
    ]);

    if (itemsError || paymentsError || movementsError) {
      return NextResponse.json({ error: "Failed to load POS order details." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      order: {
        ...order,
        subtotal: money(order.subtotal),
        discount_total: money(order.discount_total),
        total: money(order.total),
      },
      items: (items || []).map((item: Record<string, unknown>) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        unit_price: money(item.unit_price),
        discount_total: money(item.discount_total),
        line_total: money(item.line_total),
      })),
      payments: (payments || []).map((payment: Record<string, unknown>) => ({
        ...payment,
        amount: money(payment.amount),
      })),
      stock_movements: movements || [],
    });
  } catch (error) {
    console.error("[POS order detail] failed", error);
    return NextResponse.json({ error: "Failed to load POS order details." }, { status: 500 });
  }
}
