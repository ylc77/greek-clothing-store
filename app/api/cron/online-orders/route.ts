import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";

function authorized(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET || "");
  const provided = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdminClient();
  if (!supabase || process.env.USE_ONLINE_ORDER_RPC !== "true") return NextResponse.json({ error: "Online order expiry is unavailable." }, { status: 503 });
  const { data, error } = await (supabase as any).rpc("online_order_expire_pending_rpc", { p_limit: 100 });
  if (error || !data) return NextResponse.json({ error: "Online order expiry failed." }, { status: 503 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
