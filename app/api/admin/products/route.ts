import { NextRequest } from "next/server";
import {
  adminActorFromContext,
  authorizeAdminRequest,
} from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { finalizeCommittedProductMutation } from "@/lib/product-cache-policy";
import { featureDisabledResponse, isFeatureEnabled, isFeatureEnabledUncached } from "@/lib/features";
import {
  loadProductSnapshot,
  loadProductSnapshots,
  parseCreateProductMutation,
  productErrorResponse,
  productIdFromRpcResult,
  productRpcFailure,
  productRpcWasReplay,
  productSnapshotFromRpcResult,
  readProductRequestBody,
} from "@/lib/product-transactions";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { shapeProductsForRole } from "@/lib/admin-data-boundary";
import { adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";

export const dynamic = "force-dynamic";

function productRpcRequired() {
  return productErrorResponse(
    "Transactional product RPC is required before product writes can be used.",
    503,
    "PRODUCT_RPC_REQUIRED",
    false,
  );
}

async function authorize(request: NextRequest, permission: "products:read" | "products:write") {
  const decision = await authorizeAdminRequest(request, permission);
  return decision.allowed
    ? { authContext: decision.context }
    : { response: productErrorResponse(decision.error, decision.status, decision.code, true) };
}

export async function GET(request: NextRequest) {
  const authorized = await authorize(request, "products:read");
  if (authorized.response) return authorized.response;
  if (!(await isFeatureEnabled("product_management"))) {
    return applyAdminPrivateCache(featureDisabledResponse("product_management"));
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return productErrorResponse("Admin Supabase is not configured.", 503, "PRODUCT_DATA_UNAVAILABLE", false);
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const { data, count, error } = await supabase
    .from("products")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return productErrorResponse("Product data is temporarily unavailable.", 503, "PRODUCT_DATA_UNAVAILABLE", false);
  }

  try {
    const products = await loadProductSnapshots(supabase as any, (data || []) as Product[]);
    return adminPrivateJson({
      products: shapeProductsForRole(products, authorized.authContext!.role),
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[products] failed to load authoritative Variant inventory", {
      message: String((error as { message?: unknown } | null)?.message || ""),
      code: String((error as { code?: unknown } | null)?.code || ""),
    });
    return productErrorResponse("Product inventory data is temporarily unavailable.", 503, "PRODUCT_DATA_UNAVAILABLE", false);
  }
}

export async function POST(request: NextRequest) {
  const authorized = await authorize(request, "products:write");
  if (authorized.response) return authorized.response;
  if (!(await isFeatureEnabledUncached("product_management"))) {
    return applyAdminPrivateCache(featureDisabledResponse("product_management"));
  }
  if (process.env.USE_PRODUCT_RPC !== "true") return productRpcRequired();

  const parsedBody = await readProductRequestBody(request);
  if (parsedBody.response) return parsedBody.response;
  const parsed = parseCreateProductMutation(parsedBody.payload!);
  if (!parsed.mutation) {
    return productErrorResponse(parsed.error || "Invalid product.", 400, "INVALID_ARGUMENT", true);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return productErrorResponse("Admin Supabase is not configured.", 503, "PRODUCT_RPC_UNAVAILABLE", false);
  }

  let rpcData: unknown;
  try {
    const { data, error } = await (supabase as any).rpc("product_create_rpc", {
      p_client_request_id: parsed.mutation.clientRequestId,
      p_metadata: parsed.mutation.metadata,
      p_variants: parsed.mutation.variants,
      p_actor: adminActorFromContext(authorized.authContext!),
      p_source: "admin_products",
    });
    if (error) return productRpcFailure(error);
    rpcData = data;
  } catch (error) {
    return productRpcFailure(error);
  }

  const productId = productIdFromRpcResult(rpcData);
  if (!productId) {
    return productErrorResponse(
      "Product transaction committed with an unreadable result. Reuse the same operation ID to reconcile.",
      503,
      "PRODUCT_RPC_RESULT_UNKNOWN",
      false,
    );
  }

  let product = productSnapshotFromRpcResult(rpcData);
  if (!product) {
    try {
      product = await loadProductSnapshot(supabase as any, productId);
    } catch {
      return productErrorResponse(
        "Product transaction result could not be reloaded. Reuse the same operation ID to reconcile.",
        503,
        "PRODUCT_RESULT_UNAVAILABLE",
        false,
      );
    }
  }
  if (!product) {
    return productErrorResponse(
      "Product transaction result could not be found. Reuse the same operation ID to reconcile.",
      503,
      "PRODUCT_RESULT_UNAVAILABLE",
      false,
    );
  }

  const finalized = await finalizeCommittedProductMutation(product, () => invalidateProductsCache(product.sku));
  return adminPrivateJson(
    { product: finalized.value, cacheWarning: finalized.cacheWarning },
    { status: productRpcWasReplay(rpcData) ? 200 : 201 },
  );
}
