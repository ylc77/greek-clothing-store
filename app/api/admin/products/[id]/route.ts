import { NextRequest } from "next/server";
import {
  adminActorFromContext,
  adminHasPermission,
  getAdminAuthContextFromRequest,
} from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { finalizeCommittedProductMutation } from "@/lib/product-cache-policy";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import {
  loadProductSnapshot,
  parseProductArchiveMutation,
  parseUpdateProductMutation,
  productErrorResponse,
  productIdFromRpcResult,
  productRpcFailure,
  productSnapshotFromRpcResult,
  readProductRequestBody,
  type ParsedProductMutation,
} from "@/lib/product-transactions";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";

type ProductRouteContext = {
  params: Promise<{ id: string }>;
};

function productRpcRequired() {
  return productErrorResponse(
    "Transactional product RPC is required before product writes can be used.",
    503,
    "PRODUCT_RPC_REQUIRED",
    false,
  );
}

async function authorizeWrite(request: NextRequest) {
  const authContext = await getAdminAuthContextFromRequest(request);
  if (!authContext) {
    return { response: productErrorResponse("Unauthorized", 401, "UNAUTHORIZED", true) };
  }
  if (!adminHasPermission(authContext, "products:write")) {
    return { response: productErrorResponse("Forbidden", 403, "FORBIDDEN", true) };
  }
  return { authContext };
}

function parseProductId(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function executeUpdate(
  productId: number,
  mutation: ParsedProductMutation,
  actor: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { response: productErrorResponse("Admin Supabase is not configured.", 503, "PRODUCT_RPC_UNAVAILABLE", false) };
  }

  let rpcData: unknown;
  try {
    const { data, error } = await (supabase as any).rpc("product_update_rpc", {
      p_client_request_id: mutation.clientRequestId,
      p_product_id: productId,
      p_expected_metadata_version: mutation.expectedMetadataVersion,
      p_expected_structure_version: mutation.expectedStructureVersion,
      p_metadata: mutation.metadata,
      p_variants: mutation.variants,
      p_actor: actor,
      p_source: "admin_products",
    });
    if (error) return { response: productRpcFailure(error) };
    rpcData = data;
  } catch (error) {
    return { response: productRpcFailure(error) };
  }

  const resultProductId = productIdFromRpcResult(rpcData);
  if (resultProductId !== productId) {
    return {
      response: productErrorResponse(
        "Product transaction returned an unreadable or mismatched result. Reuse the same operation ID to reconcile.",
        503,
        "PRODUCT_RPC_RESULT_UNKNOWN",
        false,
      ),
    };
  }
  let product = productSnapshotFromRpcResult(rpcData);
  if (!product) {
    try {
      product = await loadProductSnapshot(supabase as any, resultProductId);
    } catch {
      return {
        response: productErrorResponse(
          "Product transaction result could not be reloaded. Reuse the same operation ID to reconcile.",
          503,
          "PRODUCT_RESULT_UNAVAILABLE",
          false,
        ),
      };
    }
  }
  if (!product) {
    return {
      response: productErrorResponse(
        "Product transaction result could not be found. Reuse the same operation ID to reconcile.",
        503,
        "PRODUCT_RESULT_UNAVAILABLE",
        false,
      ),
    };
  }

  const finalized = await finalizeCommittedProductMutation(product, () => invalidateProductsCache(product.sku));
  return { product: finalized.value, cacheWarning: finalized.cacheWarning };
}

export async function PUT(request: NextRequest, context: ProductRouteContext) {
  const authorized = await authorizeWrite(request);
  if (authorized.response) return authorized.response;
  if (!(await isFeatureEnabledUncached("product_management"))) {
    return applyAdminPrivateCache(featureDisabledResponse("product_management"));
  }
  if (process.env.USE_PRODUCT_RPC !== "true") return productRpcRequired();

  const { id } = await context.params;
  const productId = parseProductId(id);
  if (!productId) return productErrorResponse("Invalid product ID.", 400, "INVALID_ARGUMENT", true);

  const parsedBody = await readProductRequestBody(request);
  if (parsedBody.response) return parsedBody.response;
  const parsed = parseUpdateProductMutation(parsedBody.payload!);
  if (!parsed.mutation) {
    return productErrorResponse(parsed.error || "Invalid product.", 400, "INVALID_ARGUMENT", true);
  }

  const result = await executeUpdate(
    productId,
    parsed.mutation,
    adminActorFromContext(authorized.authContext!),
  );
  if (result.response) return result.response;
  return adminPrivateJson({ product: result.product, cacheWarning: result.cacheWarning });
}

export async function DELETE(request: NextRequest, context: ProductRouteContext) {
  const authorized = await authorizeWrite(request);
  if (authorized.response) return authorized.response;
  if (!(await isFeatureEnabledUncached("product_management"))) {
    return applyAdminPrivateCache(featureDisabledResponse("product_management"));
  }
  if (process.env.USE_PRODUCT_RPC !== "true") return productRpcRequired();

  const { id } = await context.params;
  const productId = parseProductId(id);
  if (!productId) return productErrorResponse("Invalid product ID.", 400, "INVALID_ARGUMENT", true);

  const parsedBody = await readProductRequestBody(request);
  if (parsedBody.response) return parsedBody.response;
  const parsed = parseProductArchiveMutation(parsedBody.payload!);
  if (!parsed.mutation) {
    return productErrorResponse(parsed.error || "Invalid product archive request.", 400, "INVALID_ARGUMENT", true);
  }

  const result = await executeUpdate(
    productId,
    parsed.mutation,
    adminActorFromContext(authorized.authContext!),
  );
  if (result.response) return result.response;
  return adminPrivateJson({ ok: true, product: result.product, cacheWarning: result.cacheWarning });
}
