import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { fetchBoxNowParcelState, getBoxNowConfig, safeBoxNowError } from "@/lib/boxnow";
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
  const orderId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f-]{36}$/i.test(operationId)) return NextResponse.json({ error: "订单或操作编号无效。" }, { status: 400 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "在线订单数据库未配置。", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  const settings = await getBusinessSettingsUncached();
  if (!settings.boxnow_enabled) return NextResponse.json({ error: "BOX NOW 尚未启用。", code: "FEATURE_DISABLED" }, { status: 403 });
  let config;
  try { config = getBoxNowConfig(); } catch { return NextResponse.json({ error: "BOX NOW 服务端配置不完整。", code: "BOXNOW_UNAVAILABLE" }, { status: 503 }); }
  const { data: shipment, error: shipmentError } = await (supabase as any).from("online_shipments").select("parcel_id").eq("order_id", orderId).maybeSingle();
  if (shipmentError) return NextResponse.json({ error: "运单资料读取失败。", code: "BOXNOW_UNAVAILABLE" }, { status: 503 });
  const parcelId = String(shipment?.parcel_id || "");
  if (!parcelId) return NextResponse.json({ error: "该订单尚未创建 BOX NOW 运单。", code: "BOXNOW_SHIPMENT_NOT_FOUND" }, { status: 404 });
  let providerState;
  try { providerState = await fetchBoxNowParcelState(parcelId, { config }); }
  catch (error) {
    const safe = safeBoxNowError(error);
    return NextResponse.json({ error: safe.code === "BOXNOW_STATUS_UNKNOWN" ? "BOX NOW 返回了尚未支持的新状态，请人工核对。" : "BOX NOW 状态读取失败。", code: safe.code }, { status: safe.code === "BOXNOW_STATUS_UNKNOWN" ? 409 : 503 });
  }
  const { data, error } = await (supabase as any).rpc("online_shipment_refresh_rpc", {
    p_order_id: orderId, p_operation_id: operationId, p_actor: adminActorFromContext(authorization.context),
    p_provider_state: providerState, p_note: "后台手动刷新 BOX NOW 状态",
  });
  if (error || !data) return NextResponse.json({ error: "物流状态保存失败，请人工核对。", code: "BOXNOW_RECONCILIATION_REQUIRED" }, { status: 409 });
  return NextResponse.json({ ok: true, shipment: data });
}
