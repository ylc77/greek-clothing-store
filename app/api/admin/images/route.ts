import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import {
  productImagesBucket,
  removeStoragePaths,
  storagePathFor,
  storagePathFromPublicUrl
} from "@/lib/storage-images";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const imageNamePattern = /^(.+)\.(jpe?g|png|webp)$/i;
const galleryImageNamePattern = /^(.+)-([1-9]\d*)\.(jpe?g|png|webp)$/i;
const webpContentType = "image/webp";
const SKROUTZ_MIN_PX = 1000;
const SKROUTZ_MAX_PX = 1600;
const WEBP_QUALITY = 82;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const HEIC_PATTERN = /\.hei[cf]s?$/i;
const HEIC_MIME_PATTERN = /^image\/hei[cf]s?$/i;

type ImageResult = {
  fileName: string;
  sku: string;
  ok: boolean;
  message: string;
  imageUrl?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json(
    { error: "Admin Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD." },
    { status: 500 }
  );
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

async function toOptimizedWebp(file: File): Promise<{ buffer: Buffer; width: number; height: number; warning?: string }> {
  // Reject HEIC/HEIF early with a clear message
  const fileNameLower = file.name.toLowerCase();
  if (
    HEIC_PATTERN.test(file.name) ||
    HEIC_PATTERN.test(fileNameLower) ||
    HEIC_MIME_PATTERN.test(file.type)
  ) {
    throw new Error(
      "暂不支持 HEIC/HEIF 格式。请在 iPhone 设置 → 相机 → 格式 → 选择「最兼容」(JPG)，或将照片先转换为 JPG/PNG 后再上传。"
    );
  }

  // Reject oversized files
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `文件大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过上限（${MAX_FILE_BYTES / 1024 / 1024}MB），请压缩后再上传。`
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  const { default: sharp } = await import("sharp");
  const meta = await sharp(input).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;
  const maxEdge = Math.max(srcW, srcH);
  let warning: string | undefined;

  // Skroutz check: both sides < 1000px
  if (srcW > 0 && srcH > 0 && srcW < SKROUTZ_MIN_PX && srcH < SKROUTZ_MIN_PX) {
    warning = `图片尺寸 ${srcW}x${srcH} 不满足 Skroutz 最低要求（至少一边 ≥ ${SKROUTZ_MIN_PX}px）`;
  }

  // Determine target dimensions
  let targetW = srcW;
  let targetH = srcH;

  if (maxEdge > SKROUTZ_MAX_PX) {
    // Downscale: max edge to 1600, keep aspect ratio
    const ratio = SKROUTZ_MAX_PX / maxEdge;
    targetW = Math.round(srcW * ratio);
    targetH = Math.round(srcH * ratio);
  }
  // If maxEdge between 1000-1600: keep original (just convert to WebP)
  // If maxEdge < 1000: keep original, don't upscale (warning already set)

  if (file.type === webpContentType || file.name.toLowerCase().endsWith(".webp")) {
    if (maxEdge > SKROUTZ_MAX_PX) {
      // Even for WebP input, downscale if too large
      return { buffer: await sharp(input).resize({ width: targetW, height: targetH, fit: "inside", withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer(), width: targetW, height: targetH, warning };
    }
    return { buffer: input, width: srcW, height: srcH, warning };
  }

  try {
    const buffer = await sharp(input)
      .rotate()
      .resize({
        width: targetW > 0 ? targetW : undefined,
        height: targetH > 0 ? targetH : undefined,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { buffer, width: targetW, height: targetH, warning };
  } catch (error) {
    // Fallback for WebP that can't be re-encoded
    if (file.type === webpContentType || file.name.toLowerCase().endsWith(".webp")) {
      return { buffer: input, width: srcW, height: srcH, warning };
    }
    // Surface the underlying error so the caller can show it to the user
    const reason = error instanceof Error ? error.message : "Unknown processing error";
    throw new Error(`图片处理失败：${reason}`);
  }
}

async function ensurePublicBucket(supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await supabase.storage.getBucket(productImagesBucket);

  if (!data && error) {
    const { error: createError } = await supabase.storage.createBucket(productImagesBucket, {
      public: true
    });
    return createError;
  }

  if (data && !data.public) {
    const { error: updateError } = await supabase.storage.updateBucket(productImagesBucket, {
      public: true
    });
    return updateError;
  }

  return null;
}

function galleryIndexFromUrl(url: string) {
  const path = storagePathFromPublicUrl(url);
  const match = path?.match(/\/gallery\/([1-9]\d*)\.webp$/);
  return match ? Number(match[1]) - 1 : null;
}

function nextGalleryIndex(imageUrls: string[]) {
  const indexes = imageUrls
    .map(galleryIndexFromUrl)
    .filter((index): index is number => typeof index === "number" && Number.isFinite(index));

  return indexes.length === 0 ? imageUrls.length : Math.max(...indexes) + 1;
}

function withCacheVersion(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

export async function POST(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
    return unauthorized();
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const bucketError = await ensurePublicBucket(supabase);
  if (bucketError) {
    return NextResponse.json({ error: bucketError.message }, { status: 500 });
  }

  const formData = await request.formData();
  const files = formData.getAll("images").filter((value): value is File => value instanceof File);
  const selectedSku = stringValue(formData.get("sku"));
  const selectedMode = stringValue(formData.get("mode"));
  const selectedUploadMode = selectedMode === "main" || selectedMode === "gallery" ? selectedMode : "";
  const results: ImageResult[] = [];

  for (const [fileIndex, file] of files.entries()) {
    const fileName = file.name.trim();
    const galleryMatch = fileName.match(galleryImageNamePattern);
    const match = fileName.match(imageNamePattern);

    if (!match) {
      results.push({
        fileName,
        sku: "",
        ok: false,
        message: "File name must be sku.jpg, sku.png, sku.webp, or SKU-1.jpg"
      });
      continue;
    }

    if (selectedSku && !selectedUploadMode) {
      results.push({
        fileName,
        sku: selectedSku,
        ok: false,
        message: "Upload mode must be main or gallery when SKU is selected"
      });
      continue;
    }

    if (selectedSku && selectedUploadMode === "main" && fileIndex > 0) {
      results.push({
        fileName,
        sku: selectedSku,
        ok: false,
        message: "Main image upload accepts one file"
      });
      continue;
    }

    const sku = selectedSku || (galleryMatch ? galleryMatch[1] : match[1]);
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, sku, image_url, image_urls")
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

    const currentImageUrls = Array.isArray(product.image_urls) ? product.image_urls.filter(Boolean) : [];
    const galleryIndex = selectedSku
      ? selectedUploadMode === "gallery"
        ? nextGalleryIndex(currentImageUrls)
        : null
      : galleryMatch
        ? Number(galleryMatch[2]) - 1
        : null;

    let webpBuffer: Buffer; let imgW = 0; let imgH = 0; let sizeWarning: string | undefined;
    try {
      const result = await toOptimizedWebp(file);
      webpBuffer = result.buffer; imgW = result.width; imgH = result.height; sizeWarning = result.warning;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown conversion error";
      results.push({ fileName, sku, ok: false, message: reason });
      continue;
    }

    const storagePath = storagePathFor(sku, galleryIndex);
    const { error: uploadError } = await supabase.storage.from(productImagesBucket).upload(storagePath, webpBuffer, {
      upsert: true,
      cacheControl: "0",
      contentType: webpContentType
    });

    if (uploadError) {
      results.push({ fileName, sku, ok: false, message: uploadError.message });
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(productImagesBucket).getPublicUrl(storagePath);
    const imageUrl = withCacheVersion(publicUrlData.publicUrl);
    const updatePayload: Record<string, unknown> =
      galleryIndex === null
        ? { image_url: imageUrl, image_width: imgW, image_height: imgH }
        : {
            image_urls: (() => {
              const imageUrls = Array.isArray(product.image_urls) ? [...product.image_urls] : [];
              imageUrls[galleryIndex] = imageUrl;
              return imageUrls.filter(Boolean);
            })() as unknown as string[]
          };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any).from("products").update(updatePayload).eq("sku", sku);

    if (updateError) {
      results.push({ fileName, sku, ok: false, message: updateError.message });
      continue;
    }

    const baseMsg = galleryIndex === null ? "Main image" : "Gallery image";
    const dimMsg = imgW > 0 && imgH > 0 ? `${imgW}×${imgH}` : "";
    results.push({
      fileName,
      sku,
      ok: true,
      message: [baseMsg, dimMsg, sizeWarning].filter(Boolean).join(" · "),
      imageUrl
    });
  }

  return NextResponse.json({
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    results
  });
}

export async function DELETE(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
    return unauthorized();
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const payload = await request.json();
  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const kind = payload.kind === "gallery" ? "gallery" : "main";
  const index = Number(payload.index);

  if (!sku) {
    return NextResponse.json({ error: "sku is required" }, { status: 400 });
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, sku, image_url, image_urls")
    .eq("sku", sku)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }

  if (!product) {
    return NextResponse.json({ error: "sku does not exist" }, { status: 404 });
  }

  if (kind === "main") {
    const path = storagePathFromPublicUrl(product.image_url) || storagePathFor(sku, null);
    await removeStoragePaths(supabase, [path]);
    const { error } = await supabase.from("products").update({ image_url: "" }).eq("sku", sku);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  const imageUrls = Array.isArray(product.image_urls) ? product.image_urls.filter(Boolean) : [];

  if (!Number.isInteger(index) || index < 0 || index >= imageUrls.length) {
    return NextResponse.json({ error: "gallery image index is invalid" }, { status: 400 });
  }

  const imageUrl = imageUrls[index];
  const path = storagePathFromPublicUrl(imageUrl) || storagePathFor(sku, index);
  await removeStoragePaths(supabase, [path]);
  const nextImageUrls = imageUrls.filter((_, itemIndex) => itemIndex !== index);
  const { error } = await supabase.from("products").update({ image_urls: nextImageUrls }).eq("sku", sku);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
