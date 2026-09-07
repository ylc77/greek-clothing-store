import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { fetchBoxNowLabel, getBoxNowConfig, safeBoxNowError } from "@/lib/boxnow";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAdminRequest(request, "online_orders:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("online_orders"))) return featureDisabledResponse("online_orders");
  const orderId = (await params).id;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "在线订单数据库未配置。" }, { status: 503 });
  const { data, error } = await (supabase as any).from("online_shipments").select("parcel_id").eq("order_id", orderId).maybeSingle();
  if (error) return NextResponse.json({ error: "运单读取失败。" }, { status: 503 });
  if (!data?.parcel_id) return NextResponse.json({ error: "订单尚无 BOX NOW 运单。" }, { status: 404 });
  try {
    const bytes = await fetchBoxNowLabel(String(data.parcel_id), { config: getBoxNowConfig() });
    return new NextResponse(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="boxnow-${encodeURIComponent(orderId)}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (providerError) {
    const safe = safeBoxNowError(providerError);
    return NextResponse.json({ error: "BOX NOW 标签暂时无法获取。", code: safe.code }, { status: 503 });
  }
}
