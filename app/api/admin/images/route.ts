import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { ImageValidationError, optimizeImageFile } from "@/lib/image-security";
import {
  configuredStorageOrigin,
  pathBelongsToProduct,
  productImagesBucket,
  productStoragePath,
  storagePathFromPublicUrl,
} from "@/lib/storage-images";
import {
  StorageLifecycleError,
  createSupabaseStorageLifecycleBackend,
  detachAndDeleteStorageObject,
  queueStorageObjectDeletion,
  uploadAndCommitStorageObject,
} from "@/lib/storage-lifecycle";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const imageNamePattern = /^(.+)\.(jpe?g|png|webp)$/i;
const galleryImageNamePattern = /^(.+)-([1-9]\d*)\.(jpe?g|png|webp)$/i;
const SKROUTZ_MIN_PX = 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 12_000;

type ImageResult = {
  fileName: string;
  sku: string;
  ok: boolean;
  message: string;
  imageUrl?: string;
  cleanupPending?: boolean;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function withCacheVersion(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function nextGalleryIndex(imageUrls: string[]) {
  return imageUrls.length;
}

function failureMessage(error: unknown) {
  if (error instanceof ImageValidationError || error instanceof StorageLifecycleError) return error.message;
  return error instanceof Error ? error.message : "Image upload failed.";
}

async function assertBucketReady(supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await supabase.storage.getBucket(productImagesBucket);
  if (error || !data) throw new StorageLifecycleError("TRACKING_UNAVAILABLE", "The product-images bucket is not installed.");
  const allowedMimeTypes = Array.isArray(data.allowed_mime_types) ? data.allowed_mime_types : [];
  if (
    data.public !== true
    || Number(data.file_size_limit || 0) !== MAX_FILE_BYTES
    || !["image/jpeg", "image/png", "image/webp"].every((mime) => allowedMimeTypes.includes(mime))
  ) throw new StorageLifecycleError("TRACKING_UNAVAILABLE", "The product-images bucket security configuration is incomplete.");
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const skroutzEnabled = await isFeatureEnabled("skroutz_feed");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  try {
    await assertBucketReady(supabase);
  } catch (error) {
    return NextResponse.json({ error: failureMessage(error), code: "STORAGE_RUNTIME_UNAVAILABLE" }, { status: 503 });
  }

  const formData = await request.formData();
  const files = formData.getAll("images").filter((value): value is File => value instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "At least one image is required." }, { status: 400 });
  if (files.length > MAX_FILES || files.reduce((total, file) => total + file.size, 0) > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: `Upload at most ${MAX_FILES} files and 50 MB per request.` }, { status: 413 });
  }

  const selectedSku = stringValue(formData.get("sku"));
  const selectedMode = stringValue(formData.get("mode"));
  const selectedUploadMode = selectedMode === "main" || selectedMode === "gallery" ? selectedMode : "";
  const results: ImageResult[] = [];
  const changedSkus = new Set<string>();
  const backend = createSupabaseStorageLifecycleBackend(supabase);

  for (const [fileIndex, file] of files.entries()) {
    const fileName = file.name.trim();
    const galleryMatch = fileName.match(galleryImageNamePattern);
    const match = fileName.match(imageNamePattern);
    if (!match) {
      results.push({ fileName, sku: "", ok: false, message: "File name must be sku.jpg, sku.png, sku.webp, or SKU-1.jpg" });
      continue;
    }
    if (selectedSku && !selectedUploadMode) {
      results.push({ fileName, sku: selectedSku, ok: false, message: "Upload mode must be main or gallery when SKU is selected" });
      continue;
    }
    if (selectedSku && selectedUploadMode === "main" && fileIndex > 0) {
      results.push({ fileName, sku: selectedSku, ok: false, message: "Main image upload accepts one file" });
      continue;
    }

    const sku = selectedSku || (galleryMatch ? galleryMatch[1] : match[1]);
    const { data: product, error: productError } = await (supabase as any)
      .from("products")
      .select("id,sku,image_url,image_urls")
      .eq("sku", sku)
      .maybeSingle();
    if (productError) {
      results.push({ fileName, sku, ok: false, message: productError.message });
      continue;
    }
    if (!product) {
      results.push({ fileName, sku, ok: false, message: "sku does not exist" });
      continue;
    }

    const productId = Number(product.id);
    const currentImageUrls = Array.isArray(product.image_urls) ? product.image_urls.filter((url: unknown) => typeof url === "string" && url) : [];
    const galleryIndex = selectedSku
      ? selectedUploadMode === "gallery" ? nextGalleryIndex(currentImageUrls) : null
      : galleryMatch ? Number(galleryMatch[2]) - 1 : null;

    try {
      const optimized = await optimizeImageFile(file, {
        maxBytes: MAX_FILE_BYTES,
        maxPixels: MAX_PIXELS,
        maxWidth: MAX_DIMENSION,
        maxHeight: MAX_DIMENSION,
        resize: { width: 1600, height: 1600, fit: "inside" },
        quality: 82,
      });
      const operationId = randomUUID();
      const path = productStoragePath(productId, sku, galleryIndex === null ? "main" : "gallery", operationId);
      const { data: publicUrlData } = supabase.storage.from(productImagesBucket).getPublicUrl(path);
      const imageUrl = withCacheVersion(publicUrlData.publicUrl);
      const oldUrl = galleryIndex === null ? String(product.image_url || "") : String(currentImageUrls[galleryIndex] || "");
      const nextGallery = [...currentImageUrls];
      if (galleryIndex !== null) nextGallery[galleryIndex] = imageUrl;

      await uploadAndCommitStorageObject({
        backend,
        object: {
          operationId,
          bucket: productImagesBucket,
          path,
          ownerType: "product",
          ownerKey: String(productId),
          reason: galleryIndex === null ? "product_main_upload" : "product_gallery_upload",
        },
        body: optimized.buffer,
        contentType: "image/webp",
        commitReference: async () => {
          const update = galleryIndex === null
            ? { image_url: imageUrl, image_width: optimized.width, image_height: optimized.height }
            : { image_urls: nextGallery.filter(Boolean) };
          const { data, error } = await (supabase as any)
            .from("products")
            .update(update)
            .eq("id", productId)
            .eq("sku", sku)
            .select("id")
            .single();
          if (error || !data) throw new Error(error?.message || "Product image reference was not updated.");
        },
      });

      let cleanupPending = false;
      const oldPath = storagePathFromPublicUrl(oldUrl, configuredStorageOrigin());
      if (oldPath && oldPath !== path && pathBelongsToProduct(oldPath, productId, sku)) {
        try {
          const cleanup = await queueStorageObjectDeletion({
            backend,
            object: {
              operationId: randomUUID(), bucket: productImagesBucket, path: oldPath,
              ownerType: "product", ownerKey: String(productId), reason: "product_image_replaced",
            },
          });
          cleanupPending = cleanup.cleanupPending;
        } catch {
          cleanupPending = true;
        }
      }

      changedSkus.add(sku);
      const sizeWarning = skroutzEnabled && optimized.sourceWidth < SKROUTZ_MIN_PX && optimized.sourceHeight < SKROUTZ_MIN_PX
        ? `Skroutz recommends at least one side of ${SKROUTZ_MIN_PX}px.`
        : "";
      results.push({
        fileName,
        sku,
        ok: true,
        message: [galleryIndex === null ? "Main image" : "Gallery image", `${optimized.width}×${optimized.height}`, sizeWarning, cleanupPending ? "old object cleanup pending" : ""].filter(Boolean).join(" · "),
        imageUrl,
        cleanupPending,
      });
    } catch (error) {
      results.push({ fileName, sku, ok: false, message: failureMessage(error), cleanupPending: error instanceof StorageLifecycleError && error.cleanupPending });
    }
  }

  for (const sku of changedSkus) invalidateProductsCache(sku);
  return NextResponse.json({
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    results,
  });
}

export async function DELETE(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  try {
    await assertBucketReady(supabase);
  } catch (error) {
    return NextResponse.json({ error: failureMessage(error), code: "STORAGE_RUNTIME_UNAVAILABLE" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const kind = payload.kind === "gallery" ? "gallery" : "main";
  const index = Number(payload.index);
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 });

  const { data: product, error: productError } = await (supabase as any)
    .from("products")
    .select("id,sku,image_url,image_urls")
    .eq("sku", sku)
    .maybeSingle();
  if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: "sku does not exist" }, { status: 404 });

  const productId = Number(product.id);
  const imageUrls = Array.isArray(product.image_urls) ? product.image_urls.filter((url: unknown) => typeof url === "string" && url) : [];
  if (kind === "gallery" && (!Number.isInteger(index) || index < 0 || index >= imageUrls.length)) {
    return NextResponse.json({ error: "gallery image index is invalid" }, { status: 400 });
  }
  const currentUrl = kind === "main" ? String(product.image_url || "") : String(imageUrls[index] || "");
  const path = storagePathFromPublicUrl(currentUrl, configuredStorageOrigin());
  const managedPath = path && pathBelongsToProduct(path, productId, sku) ? path : null;
  const nextImageUrls = kind === "gallery" ? imageUrls.filter((_: string, itemIndex: number) => itemIndex !== index) : imageUrls;
  const removeReference = async () => {
    const update = kind === "main" ? { image_url: "", image_width: null, image_height: null } : { image_urls: nextImageUrls };
    const { data, error } = await (supabase as any).from("products").update(update).eq("id", productId).eq("sku", sku).select("id").single();
    if (error || !data) throw new Error(error?.message || "Product image reference was not removed.");
  };

  try {
    let cleanupPending = false;
    if (managedPath) {
      const result = await detachAndDeleteStorageObject({
        backend: createSupabaseStorageLifecycleBackend(supabase),
        object: {
          operationId: randomUUID(), bucket: productImagesBucket, path: managedPath,
          ownerType: "product", ownerKey: String(productId), reason: "product_image_deleted",
        },
        removeReference,
      });
      cleanupPending = result.cleanupPending;
    } else {
      await removeReference();
    }
    invalidateProductsCache(sku);
    return NextResponse.json({ ok: true, cleanupPending }, { status: cleanupPending ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: failureMessage(error) }, { status: error instanceof StorageLifecycleError && error.code === "TRACKING_UNAVAILABLE" ? 503 : 500 });
  }
}
