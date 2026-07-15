import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, adminHasPermission, getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type VoidBody = {
  reason?: unknown;
  clientRequestId?: unknown;
};


function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}


function usePosRpc() {
  return process.env.USE_POS_RPC === "true";
}

function posRpcRequiredResponse() {
  return NextResponse.json(
    {
      error: "POS transactional RPC is required. Set USE_POS_RPC=true and deploy the POS RPC migrations before voiding an order.",
      code: "POS_RPC_REQUIRED",
      requiresConfiguration: true,
    },
    { status: 503 },
  );
}

function voidErrorStatus(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("pos_void_reconciliation_required")) return 409;
  if (normalized.includes("not found")) return 404;
  if (normalized.includes("refunded") || normalized.includes("only completed")) return 409;
  if (normalized.includes("required") || normalized.includes("at least")) return 400;
  return 503;
}

function logVoidError(context: string, error: unknown, extra?: Record<string, unknown>) {
  const details =
    error && typeof error === "object"
      ? {
          message: "message" in error ? String((error as { message?: unknown }).message || "") : "",
          code: "code" in error ? String((error as { code?: unknown }).code || "") : "",
        }
      : { message: String(error || "") };

  console.error(`[POS void] ${context}`, { ...details, ...extra });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authContext = await getAdminAuthContextFromRequest(request);
  if (!adminHasPermission(authContext, "pos:void")) return unauthorized();
  if (!(await isFeatureEnabled("pos_void"))) return featureDisabledResponse("pos_void");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const { id: orderId } = await context.params;
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as VoidBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const reason = text(body.reason);
  const clientRequestId = text(body.clientRequestId);
  if (reason.length < 3) {
    return NextResponse.json({ error: "作废原因必填，至少 3 个字符。" }, { status: 400 });
  }
  if (!clientRequestId) {
    return NextResponse.json({ error: "clientRequestId is required." }, { status: 400 });
  }
  const posRpcEnabled = usePosRpc();
  if (!posRpcEnabled) return posRpcRequiredResponse();
  const actor = adminActorFromContext(authContext!);

  try {
      const { data, error } = await (supabase as any).rpc("pos_void_rpc", {
        p_order_id: orderId,
        p_client_request_id: clientRequestId,
        p_reason: reason,
        p_created_by: actor,
      });

      if (error) {
        logVoidError("RPC void failed", error, { orderId, clientRequestId });
        const message = String(error.message || "Failed to void POS order.");
        const status = voidErrorStatus(message);
        const reconciliation = message.toLowerCase().includes("pos_void_reconciliation_required");
        return NextResponse.json(
          {
            error: reconciliation ? message.replace(/^POS_VOID_RECONCILIATION_REQUIRED:\s*/i, "") : message,
            code: reconciliation
              ? "POS_VOID_RECONCILIATION_REQUIRED"
              : status === 503
                ? "POS_RPC_UNAVAILABLE"
                : undefined,
            requiresManualReconciliation: reconciliation,
            requiresConfiguration: status === 503,
          },
          { status },
        );
      }

      const result = data || {};
      const affectedSkus = Array.isArray(result.affected_skus) ? result.affected_skus : [];
      for (const sku of affectedSkus) {
        invalidateProductsCache(typeof sku === "string" ? sku : null);
      }

      return NextResponse.json({
        ok: true,
        rpc: true,
        alreadyProcessed: result.already_processed === true,
        message:
          result.already_processed === true
            ? "该订单已完整作废，库存不会重复加回。"
            : "订单已作废，缺少的库存恢复已在同一事务内补齐。",
        order: result.order,
        items: result.items || [],
        payments: result.payments || [],
        restoredItems: result.restored_items || [],
      });
  } catch (error) {
    logVoidError("unexpected void failure", error, { orderId });
    return NextResponse.json(
      {
        error: "POS transactional void RPC is unavailable.",
        code: "POS_RPC_UNAVAILABLE",
        requiresConfiguration: true,
      },
      { status: 503 },
    );
  }
}
