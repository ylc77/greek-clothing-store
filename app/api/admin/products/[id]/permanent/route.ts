import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, adminHasPermission, getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import {
  configuredStorageOrigin,
  listManagedProductStoragePaths,
  pathBelongsToProduct,
  productImagesBucket,
  storagePathFromPublicUrl,
} from "@/lib/storage-images";
import { completePreparedStorageDeletion, createSupabaseStorageLifecycleBackend } from "@/lib/storage-lifecycle";
import { getSupabaseAdminClient } from "@/lib/supabase";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeleteRpcResult = {
  ok?: boolean;
  code?: string;
  productId?: number;
  sku?: string;
  blockers?: Record<string, number>;
  cleanup?: Array<{ id?: string; path?: string }>;
  replayed?: boolean;
};

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAdminAuthContextFromRequest(request);
  if (!adminHasPermission(auth, "products:delete")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth ? 403 : 401 });
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin client not configured" }, { status: 500 });
  const { id } = await context.params;
  const productId = Number(id);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  }

  const requestedOperationId = (request.headers.get("x-operation-id") || "").trim();
  if (requestedOperationId && !uuidPattern.test(requestedOperationId)) {
    return NextResponse.json({ error: "x-operation-id must be a UUID" }, { status: 400 });
  }
  const operationId = requestedOperationId || randomUUID();

  const { data: product, error: productError } = await (supabase as any)
    .from("products")
    .select("id,sku,image_url,image_urls")
    .eq("id", productId)
    .maybeSingle();
  if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });

  let storagePaths: string[] = [];
  if (product) {
    const sku = String(product.sku || "");
    const urls = [product.image_url, ...(Array.isArray(product.image_urls) ? product.image_urls : [])];
    const referencedPaths = urls
      .map((url) => storagePathFromPublicUrl(typeof url === "string" ? url : "", configuredStorageOrigin()))
      .filter((path): path is string => Boolean(path) && pathBelongsToProduct(path as string, productId, sku));
    try {
      storagePaths = Array.from(new Set([...referencedPaths, ...(await listManagedProductStoragePaths(supabase, productId, sku))]));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? `Storage inventory could not be verified: ${error.message}` : "Storage inventory could not be verified." },
        { status: 503 },
      );
    }
  }

  const { data, error } = await (supabase as any).rpc("product_permanent_delete_prepare_rpc", {
    p_product_id: productId,
    p_client_operation_id: operationId,
    p_actor: adminActorFromContext(auth!),
    p_storage_paths: storagePaths,
  });
  if (error) {
    const unavailable = /function .* does not exist|schema cache|permission denied/i.test(error.message);
    return NextResponse.json(
      { error: unavailable ? "Permanent-delete transaction RPC is unavailable." : error.message, code: unavailable ? "STORAGE_RUNTIME_UNAVAILABLE" : "PRODUCT_DELETE_FAILED" },
      { status: unavailable ? 503 : 500 },
    );
  }

  const result = (data || {}) as DeleteRpcResult;
  if (result.code === "PRODUCT_NOT_FOUND") return NextResponse.json({ error: "Product not found", code: result.code }, { status: 404 });
  if (result.code === "PRODUCT_DELETE_BLOCKED") {
    return NextResponse.json(
      {
        error: "This product has inventory, order, import, or audit history and must be deactivated instead of permanently deleted.",
        code: result.code,
        blockers: result.blockers || {},
      },
      { status: 409 },
    );
  }
  if (!result.ok || result.code !== "PRODUCT_DELETED") {
    return NextResponse.json({ error: "Permanent deletion did not produce a confirmed result.", code: result.code || "PRODUCT_DELETE_UNKNOWN" }, { status: 500 });
  }

  const backend = createSupabaseStorageLifecycleBackend(supabase);
  let cleanupPending = false;
  for (const item of result.cleanup || []) {
    if (!item.id || !item.path) {
      cleanupPending = true;
      continue;
    }
    const cleanup = await completePreparedStorageDeletion({
      backend,
      operationRowId: item.id,
      bucket: productImagesBucket,
      path: item.path,
    });
    cleanupPending = cleanupPending || cleanup.cleanupPending;
  }

  invalidateProductsCache(result.sku);
  return NextResponse.json(
    { ok: true, code: result.code, replayed: result.replayed === true, cleanupPending },
    { status: cleanupPending ? 202 : 200 },
  );
}
