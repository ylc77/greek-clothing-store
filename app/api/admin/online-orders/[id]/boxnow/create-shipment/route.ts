import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { createBoxNowShipment, getBoxNowConfig, safeBoxNowError } from "@/lib/boxnow";
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
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return NextResponse.json({ error: "操作编号无效。" }, { status: 400 });
  const orderId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: "订单编号无效。" }, { status: 400 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "在线订单数据库未配置。", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  const settings = await getBusinessSettingsUncached();
  if (!settings.boxnow_enabled || !settings.viva_payments_enabled) return NextResponse.json({ error: "BOX NOW 或 Viva 尚未启用。", code: "FEATURE_DISABLED" }, { status: 403 });
  let config;
  try { config = getBoxNowConfig(); } catch { return NextResponse.json({ error: "BOX NOW 服务端配置不完整。", code: "BOXNOW_UNAVAILABLE" }, { status: 503 }); }
  if (!settings.business_name || !settings.phone || !settings.order_notification_email) return NextResponse.json({ error: "请先在店铺设置填写商家名称、电话和订单通知邮箱。", code: "BOXNOW_ORIGIN_INCOMPLETE" }, { status: 503 });

  const fingerprint = createHash("sha256").update(JSON.stringify({ orderId, provider: "box_now" })).digest("hex");
  const prepared = await (supabase as any).rpc("online_shipment_prepare_rpc", {
    p_order_id: orderId, p_operation_id: operationId, p_request_fingerprint: fingerprint,
    p_actor: adminActorFromContext(authorization.context),
  });
  if (prepared.error || !prepared.data) return NextResponse.json({ error: "创建运单准备失败。", code: "BOXNOW_PREPARE_FAILED" }, { status: 503 });
  if (prepared.data.reconciliationRequired) return NextResponse.json({ error: "此前运单请求结果不确定，请先在 BOX NOW 后台核对，禁止重复创建。", code: "BOXNOW_RECONCILIATION_REQUIRED" }, { status: 409 });
  if (prepared.data.replayed && prepared.data.parcelId) return NextResponse.json({ ok: true, shipment: prepared.data });

  const rows = Array.isArray(prepared.data.items) ? prepared.data.items as Array<Record<string, unknown>> : [];
  const parcelName = rows.slice(0, 8).map(item => String(item.name || "")).filter(Boolean).join(", ").slice(0, 200) || String(prepared.data.orderNumber);
  try {
    const shipment = await createBoxNowShipment({
      orderNumber: String(prepared.data.orderNumber), totalCents: Number(prepared.data.totalCents),
      customer: prepared.data.customer,
      lockerId: String(prepared.data.lockerId),
      origin: { name: settings.business_name, phone: settings.phone, email: settings.order_notification_email },
      items: [{ id: `${prepared.data.orderNumber}-1`, name: parcelName, valueCents: Number(prepared.data.totalCents), weightGrams: 0 }],
    }, { config });
    const completed = await (supabase as any).rpc("online_shipment_complete_rpc", {
      p_shipment_id: prepared.data.shipmentId, p_operation_id: operationId,
      p_reference_number: shipment.referenceNumber, p_parcel_id: shipment.parcelId,
      p_failure_code: null, p_outcome_unknown: false,
    });
    if (completed.error || !completed.data) return NextResponse.json({ error: "BOX NOW 已返回运单，但本地保存失败，请人工核对，禁止重复创建。", code: "BOXNOW_RECONCILIATION_REQUIRED" }, { status: 409 });
    return NextResponse.json({ ok: true, shipment: completed.data });
  } catch (error) {
    const safe = safeBoxNowError(error);
    await (supabase as any).rpc("online_shipment_complete_rpc", {
      p_shipment_id: prepared.data.shipmentId, p_operation_id: operationId,
      p_reference_number: null, p_parcel_id: null, p_failure_code: safe.code,
      p_outcome_unknown: safe.retryable,
    });
    return NextResponse.json({ error: safe.retryable ? "BOX NOW 请求结果不确定，请先人工核对。" : "BOX NOW 运单创建失败，可安全重试。", code: safe.retryable ? "BOXNOW_RECONCILIATION_REQUIRED" : safe.code }, { status: safe.retryable ? 409 : 502 });
  }
}
