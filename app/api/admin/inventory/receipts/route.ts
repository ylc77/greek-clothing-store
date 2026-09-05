import { NextRequest } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure, adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { InventoryReceiptValidationError, parseInventoryReceiptInput } from "@/lib/inventory-receipt";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 64 * 1024;

function unavailable() {
  return adminPrivateJson({
    error: "Transactional receiving is temporarily unavailable.",
    code: "INVENTORY_RECEIPT_RPC_UNAVAILABLE",
    operationSafeToDiscard: false,
  }, { status: 503 });
}

function rpcFailure(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message || "");
  const known: Array<[string, number, string, string, boolean]> = [
    ["INVENTORY_RECEIPT_INVALID_ARGUMENT", 400, "INVALID_ARGUMENT", "Receiving data is invalid.", true],
    ["INVENTORY_RECEIPT_CONFLICT", 409, "INVENTORY_RECEIPT_CONFLICT", "This operation ID was already used for a different receipt.", false],
    ["INVENTORY_RECEIPT_SUPPLIER_NOT_FOUND", 409, "SUPPLIER_NOT_FOUND", "The selected supplier is unavailable.", true],
    ["INVENTORY_RECEIPT_VARIANT_NOT_FOUND", 409, "VARIANT_NOT_FOUND", "One or more selected Variants no longer exist.", true],
    ["INVENTORY_RECEIPT_VARIANT_INACTIVE", 409, "VARIANT_INACTIVE", "One or more selected products or Variants are inactive.", true],
    ["INVENTORY_RECEIPT_BARCODE_CONFLICT", 409, "BARCODE_CONFLICT", "A generated internal Barcode is already in use.", true],
    ["INVENTORY_RECEIPT_INVARIANT", 409, "INVENTORY_RECONCILIATION_REQUIRED", "Inventory requires reconciliation before this receipt can complete.", false],
  ];
  for (const [marker, status, code, publicMessage, safe] of known) {
    if (message.includes(marker)) {
      return adminPrivateJson({ error: publicMessage, code, operationSafeToDiscard: safe }, { status });
    }
  }
  return unavailable();
}

async function requireInventory(request: NextRequest, permission: "inventory:read" | "inventory:write") {
  const decision = await authorizeAdminRequest(request, permission);
  if (!decision.allowed) return { response: adminAuthorizationFailure(decision) };
  if (!(await isFeatureEnabled("inventory"))) {
    return { response: applyAdminPrivateCache(featureDisabledResponse("inventory")) };
  }
  return { context: decision.context };
}

export async function GET(request: NextRequest) {
  const authorized = await requireInventory(request, "inventory:read");
  if (authorized.response) return authorized.response;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const { data, error } = await (supabase as any)
    .from("inventory_receipts")
    .select("id,receipt_number,supplier_id,supplier_reference,status,received_at,notes,total_units,created_by,completed_at,suppliers(name)")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) return unavailable();
  return adminPrivateJson({ receipts: data || [] });
}

export async function POST(request: NextRequest) {
  const authorized = await requireInventory(request, "inventory:write");
  if (authorized.response) return authorized.response;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return adminPrivateJson({ error: "Request body is too large.", code: "REQUEST_TOO_LARGE", operationSafeToDiscard: true }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return adminPrivateJson({ error: "Request body is too large.", code: "REQUEST_TOO_LARGE", operationSafeToDiscard: true }, { status: 413 });
  }

  let input;
  try {
    input = parseInventoryReceiptInput(JSON.parse(raw));
  } catch (error) {
    const message = error instanceof InventoryReceiptValidationError ? error.message : "Invalid JSON body.";
    return adminPrivateJson({ error: message, code: "INVALID_ARGUMENT", operationSafeToDiscard: true }, { status: 400 });
  }
  if (input.items.some(item => item.unitCost !== null) && !authorized.context!.permissions.includes("procurement:cost")) {
    return adminPrivateJson({ error: "You do not have permission to record purchase costs.", code: "FORBIDDEN", operationSafeToDiscard: true }, { status: 403 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  try {
    const { data, error } = await (supabase as any).rpc("inventory_receipt_complete_rpc", {
      p_client_request_id: input.clientRequestId,
      p_supplier_id: input.supplierId,
      p_supplier_reference: input.supplierReference || null,
      p_notes: input.notes || null,
      p_items: input.items.map(item => ({ variantId: item.variantId, quantity: item.quantity, unitCost: item.unitCost })),
      p_created_by: adminActorFromContext(authorized.context!),
    });
    if (error) return rpcFailure(error);
    return adminPrivateJson(data);
  } catch (error) {
    return rpcFailure(error);
  }
}
