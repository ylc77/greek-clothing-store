import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
  if (!supabase) return NextResponse.json({ error: "服务端 Supabase 未配置。" }, { status: 503 });

  const url = new URL(request.url);
  const orderId = (url.searchParams.get("orderId") || "").trim();
  const { data, error } = await (supabase as any).rpc("pos_reconciliation_rpc", {
    p_start: url.searchParams.get("start") || null,
    p_end: url.searchParams.get("end") || null,
    p_order_id: orderId || null,
    p_limit: Math.max(1, integer(url.searchParams.get("limit"), 100, 500)),
    p_offset: integer(url.searchParams.get("offset"), 0, 1_000_000),
  });
  if (error || !data) {
    console.error("[POS reconciliation] unavailable", { code: String(error?.code || ""), message: String(error?.message || "") });
    return NextResponse.json({ error: "POS 对账 RPC 缺失、无权执行或不可用。" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ...data });
}
