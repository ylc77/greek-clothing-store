import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function blocked(error: string, details?: unknown) {
  return NextResponse.json(
    { error, code: "OPERATIONS_REPORTING_UNAVAILABLE", details: details || undefined },
    { status: 503 },
  );
}

function integer(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "pos:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("pos_reports"))) return featureDisabledResponse("pos_reports");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return blocked("服务端 Supabase 未配置，营业日报暂不可用。");

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "日期格式必须为 YYYY-MM-DD。" }, { status: 400 });
  }
  const limit = integer(url.searchParams.get("limit"), 100, 200);
  const offset = integer(url.searchParams.get("offset"), 0, 1_000_000);

  const { data, error } = await (supabase as any).rpc("pos_daily_report_rpc", {
    p_business_date: date,
    p_limit: Math.max(1, limit),
    p_offset: offset,
  });

  if (error || !data) {
    console.error("[POS daily report] database report unavailable", {
      code: String(error?.code || ""),
      message: String(error?.message || ""),
    });
    return blocked("Europe/Athens 营业日报 RPC 缺失、无权执行或不可用。");
  }

  return NextResponse.json({ ok: true, ...data });
}
