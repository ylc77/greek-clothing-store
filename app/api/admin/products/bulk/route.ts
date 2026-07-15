import { NextRequest, NextResponse } from "next/server";
import {
  adminActorFromContext,
  adminHasPermission,
  getAdminAuthContextFromRequest,
} from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { finalizeCommittedProductMutation } from "@/lib/product-cache-policy";
import {
  productErrorResponse,
  productRpcFailure,
  readProductRequestBody,
} from "@/lib/product-transactions";
import { getSupabaseAdminClient } from "@/lib/supabase";

const MAX_BULK_ITEMS = 100;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;

type BulkStatusItem = {
  product_id: number;
  expected_metadata_version: number;
  expected_structure_version: number;
  is_active: boolean;
};

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBulkRequest(payload: Record<string, unknown>) {
  const clientRequestId = typeof payload.clientRequestId === "string"
    ? payload.clientRequestId.trim()
    : "";
  if (!clientRequestId || clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return { error: "clientRequestId must contain 1 to 128 characters" };
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > MAX_BULK_ITEMS) {
    return { error: `items must contain 1 to ${MAX_BULK_ITEMS} products` };
  }

  const seenProductIds = new Set<number>();
  const items: BulkStatusItem[] = [];
  for (let index = 0; index < payload.items.length; index += 1) {
    const raw = payload.items[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { error: `items[${index}] must be an object` };
    }
    const value = raw as Record<string, unknown>;
    const productId = positiveInteger(value.productId);
    const expectedMetadataVersion = positiveInteger(value.expectedMetadataVersion);
    const expectedStructureVersion = positiveInteger(value.expectedStructureVersion);
    if (!productId) return { error: `items[${index}].productId must be a positive integer` };
    if (!expectedMetadataVersion) {
      return { error: `items[${index}].expectedMetadataVersion must be a positive integer` };
    }
    if (!expectedStructureVersion) {
      return { error: `items[${index}].expectedStructureVersion must be a positive integer` };
    }
    if (typeof value.isActive !== "boolean") {
      return { error: `items[${index}].isActive must be boolean` };
    }
    if (seenProductIds.has(productId)) return { error: `Duplicate productId ${productId}` };
    seenProductIds.add(productId);
    items.push({
      product_id: productId,
      expected_metadata_version: expectedMetadataVersion,
      expected_structure_version: expectedStructureVersion,
      is_active: value.isActive,
    });
  }
  return { clientRequestId, items };
}

export async function PUT(request: NextRequest) {
  const authContext = await getAdminAuthContextFromRequest(request);
  if (!authContext) return productErrorResponse("Unauthorized", 401, "UNAUTHORIZED", true);
  if (!adminHasPermission(authContext, "products:write")) {
    return productErrorResponse("Forbidden", 403, "FORBIDDEN", true);
  }
  if (!(await isFeatureEnabledUncached("product_management"))) return featureDisabledResponse("product_management");
  if (process.env.USE_PRODUCT_RPC !== "true") {
    return productErrorResponse(
      "Transactional product RPC is required before bulk product writes can be used.",
      503,
      "PRODUCT_RPC_REQUIRED",
      false,
    );
  }

  const parsedBody = await readProductRequestBody(request);
  if (parsedBody.response) return parsedBody.response;
  const parsed = parseBulkRequest(parsedBody.payload!);
  if (!parsed.clientRequestId || !parsed.items) {
    return productErrorResponse(parsed.error || "Invalid bulk product request.", 400, "INVALID_ARGUMENT", true);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return productErrorResponse("Admin Supabase is not configured.", 503, "PRODUCT_RPC_UNAVAILABLE", false);
  }

  let rpcData: unknown;
  try {
    const { data, error } = await (supabase as any).rpc("product_bulk_status_rpc", {
      p_client_request_id: parsed.clientRequestId,
      p_items: parsed.items,
      p_actor: adminActorFromContext(authContext),
      p_source: "admin_products_bulk",
    });
    if (error) return productRpcFailure(error);
    rpcData = data;
  } catch (error) {
    return productRpcFailure(error);
  }

  const finalized = await finalizeCommittedProductMutation(rpcData, () => invalidateProductsCache());
  const result = finalized.value && typeof finalized.value === "object"
    ? finalized.value as Record<string, unknown>
    : {};
  return NextResponse.json({
    ...result,
    ok: true,
    cacheWarning: finalized.cacheWarning,
  });
}
