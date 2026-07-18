import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function blocked(error: string, code: string, details?: unknown) {
  return NextResponse.json(
    {
      ready: false,
      error,
      code,
      requiresConfiguration: true,
      details: details || undefined,
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "pos:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("pos_checkout"))) return featureDisabledResponse("pos_checkout");

  if (process.env.USE_POS_RPC !== "true") {
    return blocked(
      "POS 已启用，但事务 RPC 配置未启用。请先部署 POS RPC migration 并设置 USE_POS_RPC=true。",
      "POS_RPC_REQUIRED",
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return blocked("服务端 Supabase 未配置，POS 写入已阻断。", "POS_RPC_UNAVAILABLE");
  }

  const [{ data, error }, operations, reconciliation] = await Promise.all([
    (supabase as any).rpc("pos_runtime_health_rpc"),
    (supabase as any).rpc("operations_runtime_health_rpc"),
    (supabase as any).rpc("pos_reconciliation_rpc", {
      p_start: null,
      p_end: null,
      p_order_id: null,
      p_limit: 20,
      p_offset: 0,
    }),
  ]);
  if (error || operations.error || reconciliation.error) {
    console.error("[POS health] runtime RPC check failed", {
      message: String(error?.message || operations.error?.message || reconciliation.error?.message || ""),
      code: String(error?.code || operations.error?.code || reconciliation.error?.code || ""),
    });
    return blocked("POS 事务 RPC 缺失、无权执行或不可用，POS 写入已阻断。", "POS_RPC_UNAVAILABLE");
  }

  if (data?.ready !== true || operations.data?.ready !== true) {
    return blocked("POS 事务、报表、对账或条码 RPC 未完整部署或权限不正确，POS 写入已阻断。", "POS_RPC_UNAVAILABLE", {
      transaction: data,
      operations: operations.data,
    });
  }

  return NextResponse.json({
    ready: true,
    version: data.version,
    details: {
      transaction: data,
      operations: operations.data,
      reconciliationIssueCount: Number(reconciliation.data?.issue_count || 0),
      reconciliationSample: reconciliation.data?.items || [],
    },
  });
}
