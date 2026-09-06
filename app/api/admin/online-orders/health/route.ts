import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { getBoxNowConfig } from "@/lib/boxnow";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getBusinessSettingsUncached } from "@/lib/settings";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getVivaConfig, getVivaWebhookVerificationKey } from "@/lib/viva";

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "online_orders:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("online_orders"))) return featureDisabledResponse("online_orders");
  const issues: string[] = [];
  if (process.env.USE_ONLINE_ORDER_RPC !== "true") issues.push("USE_ONLINE_ORDER_RPC 未启用");
  const supabase = getSupabaseAdminClient();
  if (!supabase) issues.push("Supabase 服务端连接不可用");
  const settings = await getBusinessSettingsUncached();
  if (!settings.online_store_enabled) issues.push("在线购物尚未开启");
  if (!settings.viva_payments_enabled) issues.push("Viva 在线付款尚未开启");
  if (!settings.pickup_enabled && !settings.boxnow_enabled) issues.push("没有启用任何履约方式");
  try { getVivaConfig(); } catch { issues.push("Viva 服务端配置不完整"); }
  try { getVivaWebhookVerificationKey(); } catch { issues.push("Viva Webhook 验证配置不完整"); }
  if (settings.boxnow_enabled) {
    try { getBoxNowConfig(); } catch { issues.push("BOX NOW 服务端配置不完整"); }
    if (!/^\d{1,20}$/.test(String(process.env.NEXT_PUBLIC_BOXNOW_PARTNER_ID || "").trim())) issues.push("BOX NOW Locker Widget Partner ID 无效");
  }
  if (String(process.env.CRON_SECRET || "").length < 32) issues.push("CRON_SECRET 未安全配置");
  let database: Record<string, unknown> | null = null;
  if (supabase) {
    const result = await (supabase as any).rpc("online_commerce_runtime_health_rpc");
    if (result.error || !result.data) issues.push("在线购物事务 RPC migration 未就绪");
    else {
      database = result.data as Record<string, unknown>;
      if (database.ready !== true) issues.push("在线购物数据库运行条件未就绪");
    }
  }
  return NextResponse.json({ ready: issues.length === 0, issues, database }, { status: issues.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
