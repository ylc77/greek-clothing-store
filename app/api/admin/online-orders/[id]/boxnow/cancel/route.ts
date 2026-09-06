import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { cancelBoxNowParcel, getBoxNowConfig, safeBoxNowError } from "@/lib/boxnow";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getBusinessSettingsUncached } from "@/lib/settings";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAdminRequest(request, "online_orders:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("online_orders"))) return featureDisabledResponse("online_orders");
  if (process.env.USE_ONLINE_ORDER_RPC !== "true") return NextResponse.json({ error: "在线订单事务 RPC 未启用。", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式无效。" }, { status: 400 }); }
  const operationId = String(body.operationId || "");
  const note = String(body.note || "").trim().slice(0, 500) || null;
  const orderId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f-]{36}$/i.test(operationId)) return NextResponse.json({ error: "订单或操作编号无效。" }, { status: 400 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "在线订单数据库未配置。", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  const settings = await getBusinessSettingsUncached();
  if (!settings.boxnow_enabled) return NextResponse.json({ error: "BOX NOW 尚未启用。", code: "FEATURE_DISABLED" }, { status: 403 });
  let config;
  try { config = getBoxNowConfig(); } catch { return NextResponse.json({ error: "BOX NOW 服务端配置不完整。", code: "BOXNOW_UNAVAILABLE" }, { status: 503 }); }

  const fingerprint = createHash("sha256").update(JSON.stringify({ orderId, action: "boxnow_cancel" })).digest("hex");
  const prepared = await (supabase as any).rpc("online_shipment_cancel_prepare_rpc", {
    p_order_id: orderId,
    p_operation_id: operationId,
    p_request_fingerprint: fingerprint,
    p_actor: adminActorFromContext(authorization.context),
    p_note: note,
  });
  if (prepared.error || !prepared.data) {
    const message = String(prepared.error?.message || "");
    return NextResponse.json({ error: message.includes("NOT_ALLOWED") ? "该运单已交接或当前状态不允许取消。" : "取消运单准备失败。", code: "BOXNOW_CANCEL_PREPARE_FAILED" }, { status: message.includes("NOT_ALLOWED") ? 409 : 503 });
  }
  if (prepared.data.reconciliationRequired) return NextResponse.json({ error: "此前取消请求结果不确定，请先在 BOX NOW 后台核对。", code: "BOXNOW_RECONCILIATION_REQUIRED" }, { status: 409 });
  if (prepared.data.ok && prepared.data.status === "cancelled") return NextResponse.json({ ok: true, shipment: prepared.data });
  if (!prepared.data.parcelId) return NextResponse.json({ error: "BOX NOW 拒绝了此前的取消请求。", code: "BOXNOW_CANCEL_REJECTED" }, { status: 409 });

  try {
    await cancelBoxNowParcel(String(prepared.data.parcelId), { config });
    const completed = await (supabase as any).rpc("online_shipment_cancel_complete_rpc", {
      p_order_id: orderId, p_operation_id: operationId, p_cancelled: true,
      p_failure_code: null, p_outcome_unknown: false,
    });
    if (completed.error || !completed.data) return NextResponse.json({ error: "BOX NOW 已取消运单，但本地保存失败，请人工核对。", code: "BOXNOW_RECONCILIATION_REQUIRED" }, { status: 409 });
    return NextResponse.json({ ok: true, shipment: completed.data });
  } catch (error) {
    const safe = safeBoxNowError(error);
    await (supabase as any).rpc("online_shipment_cancel_complete_rpc", {
      p_order_id: orderId, p_operation_id: operationId, p_cancelled: false,
      p_failure_code: safe.code, p_outcome_unknown: safe.retryable,
    });
    return NextResponse.json({ error: safe.retryable ? "BOX NOW 取消结果不确定，请先人工核对。" : "BOX NOW 不允许取消该运单。", code: safe.retryable ? "BOXNOW_RECONCILIATION_REQUIRED" : safe.code }, { status: 409 });
  }
}
