import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { invalidateCategoriesCache, invalidateSettingsCache } from "@/lib/cache";
import { developerRequestIsAuthorized } from "@/lib/developer-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { ImageValidationError, optimizeImageFile } from "@/lib/image-security";
import { getBusinessSettingsUncached } from "@/lib/settings";
import {
  categoryStoragePath,
  configuredStorageOrigin,
  productImagesBucket,
  settingsStoragePath,
  storagePathFromPublicUrl,
} from "@/lib/storage-images";
import {
  StorageLifecycleError,
  createSupabaseStorageLifecycleBackend,
  queueStorageObjectDeletion,
  uploadAndCommitStorageObject,
} from "@/lib/storage-lifecycle";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 12_000;
const allowedTargets = new Set(["logo", "hero", "category"] as const);
type UploadTarget = "logo" | "hero" | "category";

function errorResponse(error: unknown) {
  if (error instanceof ImageValidationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
  if (error instanceof StorageLifecycleError) {
    const status = error.code === "TRACKING_UNAVAILABLE" ? 503 : 500;
    return NextResponse.json({ error: error.message, code: error.code, cleanupPending: error.cleanupPending }, { status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Image upload failed." }, { status: 500 });
}

async function assertBucketReady(supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await supabase.storage.getBucket(productImagesBucket);
  if (error || !data) throw new StorageLifecycleError("TRACKING_UNAVAILABLE", "The product-images bucket is not installed.");
  const allowedMimeTypes = Array.isArray(data.allowed_mime_types) ? data.allowed_mime_types : [];
  if (
    data.public !== true
    || Number(data.file_size_limit || 0) !== MAX_FILE_BYTES
    || !["image/jpeg", "image/png", "image/webp"].every((mime) => allowedMimeTypes.includes(mime))
  ) {
    throw new StorageLifecycleError("TRACKING_UNAVAILABLE", "The product-images bucket security configuration is incomplete.");
  }
}

export async function POST(request: NextRequest) {
  const targetValue = request.nextUrl.searchParams.get("target") || "";
  if (!allowedTargets.has(targetValue as UploadTarget)) {
    return NextResponse.json({ error: "target must be logo, hero, or category" }, { status: 400 });
  }
  const target = targetValue as UploadTarget;

  if (target === "category") {
    if (!(await adminRequestHasPermissionAsync(request, "categories:write"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  } else if (!(await developerRequestIsAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase admin client not configured" }, { status: 500 });

  try {
    await assertBucketReady(supabase);
    const formData = await request.formData();
    if (formData.has("name")) {
      return NextResponse.json({ error: "name is no longer accepted; use the strict target query parameter" }, { status: 400 });
    }
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing image file" }, { status: 400 });

    const operationId = randomUUID();
    const categoryId = request.nextUrl.searchParams.get("categoryId") || "";
    let ownerKey: string;
    let path: string;
    let oldUrl = "";
    let commitReference: (url: string, width: number, height: number) => Promise<void>;

    if (target === "category") {
      path = categoryStoragePath(categoryId, operationId);
      ownerKey = categoryId;
      const { data: category, error } = await (supabase as any)
        .from("product_categories")
        .select("id,image_url")
        .eq("id", categoryId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!category) return NextResponse.json({ error: "Save the category before uploading its image." }, { status: 409 });
      oldUrl = typeof category.image_url === "string" ? category.image_url : "";
      commitReference = async (url) => {
        const { data, error: updateError } = await (supabase as any)
          .from("product_categories")
          .update({ image_url: url })
          .eq("id", categoryId)
          .select("id")
          .single();
        if (updateError || !data) throw new Error(updateError?.message || "Category image reference was not updated.");
      };
    } else {
      const settings = await getBusinessSettingsUncached();
      path = settingsStoragePath(target, operationId);
      ownerKey = String(settings.id);
      oldUrl = target === "logo" ? settings.logo_url : settings.hero_image_url;
      const field = target === "logo" ? "logo_url" : "hero_image_url";
      commitReference = async (url) => {
        const { data, error } = await (supabase as any)
          .from("business_settings")
          .update({ [field]: url })
          .eq("id", settings.id)
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message || "Store image reference was not updated.");
      };
    }

    const optimized = await optimizeImageFile(file, {
      maxBytes: MAX_FILE_BYTES,
      maxPixels: MAX_PIXELS,
      maxWidth: MAX_DIMENSION,
      maxHeight: MAX_DIMENSION,
      resize: target === "logo"
        ? { width: 400, height: 160, fit: "inside" }
        : target === "hero"
          ? { width: 1920, height: 1080, fit: "inside" }
          : { width: 1600, height: 1600, fit: "inside" },
      quality: 82,
    });

    const { data: publicUrl } = supabase.storage.from(productImagesBucket).getPublicUrl(path);
    const url = `${publicUrl.publicUrl}?v=${Date.now()}`;
    const backend = createSupabaseStorageLifecycleBackend(supabase);
    await uploadAndCommitStorageObject({
      backend,
      object: {
        operationId,
        bucket: productImagesBucket,
        path,
        ownerType: target === "category" ? "category" : "business_settings",
        ownerKey,
        reason: `${target}_image_upload`,
      },
      body: optimized.buffer,
      contentType: "image/webp",
      commitReference: () => commitReference(url, optimized.width, optimized.height),
    });

    let cleanupPending = false;
    const oldPath = storagePathFromPublicUrl(oldUrl, configuredStorageOrigin());
    if (oldPath && oldPath !== path) {
      try {
        const cleanup = await queueStorageObjectDeletion({
          backend,
          object: {
            operationId: randomUUID(),
            bucket: productImagesBucket,
            path: oldPath,
            ownerType: target === "category" ? "category" : "business_settings",
            ownerKey,
            reason: `${target}_image_replaced`,
          },
        });
        cleanupPending = cleanup.cleanupPending;
      } catch {
        cleanupPending = true;
      }
    }

    if (target === "category") invalidateCategoriesCache();
    else invalidateSettingsCache();
    return NextResponse.json({ url, width: optimized.width, height: optimized.height, cleanupPending }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
