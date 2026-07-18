import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function clean(value: string | null) {
  return (value || "").trim();
}

function integer(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "pos:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("pos_orders"))) return featureDisabledResponse("pos_orders");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "服务端 Supabase 未配置。", code: "OPERATIONS_REPORTING_UNAVAILABLE" }, { status: 503 });
  }

  const url = new URL(request.url);
  const { data, error } = await (supabase as any).rpc("pos_orders_page_rpc", {
    p_query: clean(url.searchParams.get("q")),
    p_status: clean(url.searchParams.get("status")) || "all",
    p_payment_method: clean(url.searchParams.get("paymentMethod")) || "all",
    p_date_range: clean(url.searchParams.get("dateRange")) || "today",
    p_limit: Math.max(1, integer(url.searchParams.get("limit"), 50, 200)),
    p_offset: integer(url.searchParams.get("offset"), 0, 1_000_000),
  });

  if (error || !data) {
    if (String(error?.message || "").includes("POS_REPORT_INVALID_FILTER")) {
      return NextResponse.json({ error: "订单筛选条件无效。" }, { status: 400 });
    }
    console.error("[POS orders] database page unavailable", {
      code: String(error?.code || ""),
      message: String(error?.message || ""),
    });
    return NextResponse.json(
      { error: "订单分页 RPC 缺失、无权执行或不可用。", code: "OPERATIONS_REPORTING_UNAVAILABLE" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, ...data });
}
