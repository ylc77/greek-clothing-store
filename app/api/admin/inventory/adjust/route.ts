import { NextRequest, NextResponse } from "next/server";
import {
  adminActorFromContext,
  authorizeAdminRequest,
} from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUANTITY = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdjustmentBody = {
  variantId?: unknown;
  mode?: unknown;
  quantity?: unknown;
  reason?: unknown;
  clientRequestId?: unknown;
  operationType?: unknown;
};

function errorResponse(
  error: string,
  status: number,
  code: string,
  operationSafeToDiscard: boolean,
) {
  return NextResponse.json({ error, code, operationSafeToDiscard }, { status });
}

async function readBody(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { response: errorResponse("Request body is too large.", 413, "REQUEST_TOO_LARGE", true) };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { response: errorResponse("Request body is too large.", 413, "REQUEST_TOO_LARGE", true) };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
    return { payload: value as AdjustmentBody };
  } catch {
    return { response: errorResponse("Invalid JSON body.", 400, "INVALID_ARGUMENT", true) };
  }
}

function rpcFailure(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message || "");
  const known: Array<[string, number, string, string, boolean]> = [
    ["INVENTORY_INVALID_ARGUMENT", 400, "INVALID_ARGUMENT", "Inventory operation parameters are invalid.", true],
    ["INVENTORY_OPERATION_CONFLICT", 409, "INVENTORY_OPERATION_CONFLICT", "This operation ID was already used with different parameters.", false],
    ["INVENTORY_NOT_FOUND", 404, "INVENTORY_NOT_FOUND", "The requested inventory record was not found.", true],
    ["INVENTORY_INACTIVE", 409, "INVENTORY_INACTIVE", "The product or variant is inactive.", true],
    ["INVENTORY_INSUFFICIENT_AVAILABLE", 409, "INVENTORY_INSUFFICIENT_AVAILABLE", "Available inventory is insufficient.", true],
    ["INVENTORY_INSUFFICIENT_STOCK", 409, "INVENTORY_INSUFFICIENT_STOCK", "The adjustment would make inventory negative.", true],
    ["INVENTORY_RESERVED_CONFLICT", 409, "INVENTORY_RESERVED_CONFLICT", "The adjustment would reduce on-hand inventory below reserved inventory.", true],
    ["INVENTORY_INVARIANT", 409, "INVENTORY_RECONCILIATION_REQUIRED", "Inventory data requires manual reconciliation.", false],
  ];
  for (const [marker, status, code, publicMessage, safe] of known) {
    if (message.includes(marker)) return errorResponse(publicMessage, status, code, safe);
  }
  return errorResponse(
    "Transactional inventory RPC is unavailable.",
    503,
    "INVENTORY_RPC_UNAVAILABLE",
    false,
  );
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "inventory:write");
  if (!authorization.allowed) {
    return errorResponse(authorization.error, authorization.status, authorization.code, true);
  }
  const authContext = authorization.context;
  if (!(await isFeatureEnabledUncached("inventory"))) return featureDisabledResponse("inventory");

  const parsed = await readBody(request);
  if (parsed.response) return parsed.response;
  const payload = parsed.payload!;
  const variantId = typeof payload.variantId === "string" ? payload.variantId.trim() : "";
  const mode = payload.mode === "set_to" || payload.mode === "adjust_by" ? payload.mode : null;
  const quantity = Number(payload.quantity);
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  const clientRequestId = typeof payload.clientRequestId === "string" ? payload.clientRequestId.trim() : "";
  const operationType = payload.operationType === undefined
    ? "manual"
    : payload.operationType === "stocktake"
      || payload.operationType === "receiving"
      || payload.operationType === "return"
      || payload.operationType === "manual"
      ? payload.operationType
      : null;

  if (!UUID_PATTERN.test(variantId)) return errorResponse("variantId must be a UUID.", 400, "INVALID_ARGUMENT", true);
  if (!mode) return errorResponse("mode must be set_to or adjust_by.", 400, "INVALID_ARGUMENT", true);
  if (!operationType) return errorResponse("Invalid operationType.", 400, "INVALID_ARGUMENT", true);
  if (!Number.isInteger(quantity) || Math.abs(quantity) > MAX_QUANTITY) {
    return errorResponse("quantity must be an integer between -1000000 and 1000000.", 400, "INVALID_ARGUMENT", true);
  }
  if (reason.length < 3 || reason.length > 500) {
    return errorResponse("reason must contain 3 to 500 characters.", 400, "INVALID_ARGUMENT", true);
  }
  if (!clientRequestId || clientRequestId.length > 128) {
    return errorResponse("clientRequestId must contain 1 to 128 characters.", 400, "INVALID_ARGUMENT", true);
  }
  if (operationType === "stocktake" && (mode !== "set_to" || quantity < 0)) {
    return errorResponse("stocktake must set a non-negative counted quantity.", 400, "INVALID_ARGUMENT", true);
  }
  if ((operationType === "receiving" || operationType === "return") && (mode !== "adjust_by" || quantity <= 0)) {
    return errorResponse("receiving and return must add a positive quantity.", 400, "INVALID_ARGUMENT", true);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return errorResponse("Admin Supabase is not configured.", 503, "INVENTORY_RPC_UNAVAILABLE", false);

  try {
    const { data, error } = await (supabase as any).rpc("inventory_apply_rpc", {
      p_client_request_id: clientRequestId,
      p_variant_id: variantId,
      p_mode: mode,
      p_quantity: quantity,
      p_operation_type: operationType,
      p_reason: reason,
      p_created_by: adminActorFromContext(authContext),
      p_auto_deactivate: false,
    });
    if (error) return rpcFailure(error);
    return NextResponse.json(data);
  } catch (error) {
    return rpcFailure(error);
  }
}
