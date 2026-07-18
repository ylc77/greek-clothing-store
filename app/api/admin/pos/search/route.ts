import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "pos:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("pos_checkout"))) return featureDisabledResponse("pos_checkout");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "服务端 Supabase 未配置。", code: "OPERATIONS_REPORTING_UNAVAILABLE" }, { status: 503 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  const { data, error } = await (supabase as any).rpc("pos_search_rpc", {
    p_query: query,
    p_limit: 20,
  });

  if (error || !data) {
    console.error("[POS search] database search unavailable", {
      code: String(error?.code || ""),
      message: String(error?.message || ""),
    });
    return NextResponse.json(
      { error: "POS 数据库搜索 RPC 缺失、无权执行或不可用。", code: "OPERATIONS_REPORTING_UNAVAILABLE" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, items: data.items || [], total: Number(data.total || 0) });
}
