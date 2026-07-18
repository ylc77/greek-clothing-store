import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { adminPrivateJson } from "@/lib/admin-response";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function integer(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "backup:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "服务端 Supabase 未配置。" }, { status: 503 });

  const url = new URL(request.url);
  const limit = Math.max(1, integer(url.searchParams.get("limit"), 100, 200));
  const offset = integer(url.searchParams.get("offset"), 0, 1_000_000);
  let query = (supabase as any)
    .from("audit_logs")
    .select("id,actor,actor_user_id,actor_role,auth_type,action,entity,entity_id,before,after,metadata,event_version,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  const action = (url.searchParams.get("action") || "").trim();
  if (action) query = query.eq("action", action);
  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: "审计事件读取失败。" }, { status: 503 });
  return adminPrivateJson({ ok: true, events: data || [], total: Number(count || 0), limit, offset });
}
