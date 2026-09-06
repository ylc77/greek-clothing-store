import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { parsePosReturnExchangeInput } from "@/lib/pos-return";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function rpcRequired() {
  return NextResponse.json({
    error: "POS 退换货事务功能未配置，当前操作已阻止。",
    code: "POS_RETURN_RPC_REQUIRED",
    requiresConfiguration: true,
    operationSafeToDiscard: true,
  }, { status: 503 });
}

function statusFor(message: string) {
  const value = message.toLowerCase();
  if (value.includes("not_found")) return 404;
  if (value.includes("quantity_exceeded") || value.includes("insufficient_stock") || value.includes("price_changed") || value.includes("idempotency_conflict") || value.includes("conflict")) return 409;
  if (value.includes("invalid") || value.includes("confirmation_required")) return 400;
  return 503;
}

async function authorize(request: NextRequest) {
  const decision = await authorizeAdminRequest(request, "pos:void");
  if (!decision.allowed) return { response: adminAuthorizationFailure(decision), context: null };
  if (!(await isFeatureEnabled("pos_void"))) return { response: featureDisabledResponse("pos_void"), context: null };
  return { response: null, context: decision.context };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return rpcRequired();
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Order id is required." }, { status: 400 });

  const { data, error } = await (supabase as any)
    .from("sales_returns")
    .select("id, return_number, status, reason, return_subtotal, exchange_subtotal, balance_delta, external_action, external_method, external_reference, created_by, created_at, completed_at, sales_return_items(id, original_order_item_id, variant_id, quantity, condition, return_amount), sales_exchanges(id, exchange_number, subtotal, return_credit_applied, amount_due, created_at, sales_exchange_items(id, variant_id, variant_sku, quantity, unit_price, line_total))")
    .eq("original_order_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[POS return] history unavailable", { code: String(error.code || ""), message: String(error.message || "") });
    return rpcRequired();
  }
  return NextResponse.json({ ok: true, returns: data || [] });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authorize(request);
  if (auth.response || !auth.context) return auth.response;
  if (process.env.USE_POS_RPC !== "true") return rpcRequired();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return rpcRequired();
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Order id is required." }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: "请求内容过大。", operationSafeToDiscard: true }, { status: 413 });

  let input;
  try {
    input = parsePosReturnExchangeInput(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求内容无效。", operationSafeToDiscard: true }, { status: 400 });
  }

  const { data, error } = await (supabase as any).rpc("pos_return_exchange_rpc", {
    p_original_order_id: id,
    p_client_request_id: input.clientRequestId,
    p_return_items: input.returnItems,
    p_exchange_items: input.exchangeItems,
    p_reason: input.reason,
    p_external_confirmation: input.externalConfirmation,
    p_created_by: adminActorFromContext(auth.context),
  });
  if (error || !data) {
    const message = String(error?.message || "POS return/exchange RPC is unavailable.");
    const status = statusFor(message);
    console.error("[POS return] transactional operation failed", { code: String(error?.code || ""), message, orderId: id });
    return NextResponse.json({
      error: message.replace(/^POS_RETURN_[A-Z_]+:\s*/i, ""),
      code: message.match(/POS_RETURN_[A-Z_]+/)?.[0] || "POS_RETURN_RPC_UNAVAILABLE",
      operationSafeToDiscard: status >= 400 && status < 500,
      requiresConfiguration: status === 503,
    }, { status });
  }

  for (const sku of Array.isArray(data.affected_skus) ? data.affected_skus : []) {
    invalidateProductsCache(typeof sku === "string" ? sku : null);
  }
  return NextResponse.json({ ok: true, rpc: true, alreadyProcessed: data.already_processed === true, ...data });
}
