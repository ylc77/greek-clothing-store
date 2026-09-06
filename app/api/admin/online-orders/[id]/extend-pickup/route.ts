import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAdminRequest(request, "online_orders:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("online_orders"))) return featureDisabledResponse("online_orders");
  if (process.env.USE_ONLINE_ORDER_RPC !== "true") return NextResponse.json({ error: "在线订单事务 RPC 未启用。", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式无效。" }, { status: 400 }); }
  const operationId = String(body.operationId || "");
  const days = Math.trunc(Number(body.days));
  const note = String(body.note || "").trim().slice(0, 500) || null;
  const orderId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f-]{36}$/i.test(operationId) || days < 1 || days > 30) return NextResponse.json({ error: "延长天数或操作编号无效。" }, { status: 400 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "在线订单数据库未配置。", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  const { data, error } = await (supabase as any).rpc("online_order_extend_pickup_rpc", {
    p_order_id: orderId, p_operation_id: operationId, p_actor: adminActorFromContext(authorization.context), p_days: days, p_note: note,
  });
  if (error || !data) {
    const message = String(error?.message || "");
    return NextResponse.json({ error: message.includes("INVALID_TRANSITION") ? "当前订单状态不允许延长自提时间。" : "延长自提时间失败。", code: "ONLINE_ORDER_EXTEND_FAILED" }, { status: message.includes("INVALID_TRANSITION") ? 409 : 503 });
  }
  return NextResponse.json({ ok: true, order: data });
}
