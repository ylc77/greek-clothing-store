import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { invalidateProductsCache } from "@/lib/cache";
import { ImageValidationError, optimizeUploadedImage } from "@/lib/image-security";
import { downloadRemoteImage } from "@/lib/secure-image-fetch";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { configuredStorageOrigin, productImagesBucket, productStoragePath } from "@/lib/storage-images";
import { createSupabaseStorageLifecycleBackend, uploadAndCommitStorageObject } from "@/lib/storage-lifecycle";

export const runtime = "nodejs";

const imageModelFallback = "gpt-image-2";
const imageWidth = 1024;
const imageHeight = 1536;
const imageSize = `${imageWidth}x${imageHeight}`;
const imageQuality = "medium";
const imageOutputFormat = "webp";
const imageOutputCompression = 85;
const maxSourceImages = 2;
const maxSourceImageBytes = 15 * 1024 * 1024;
const maxSourcePixels = 40_000_000;
const maxSourceDimension = 12_000;

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function withCacheVersion(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildStyleImagePrompt(product: Record<string, unknown>, modelType: string, style: string) {
  const productName = optionalText(product.name_en) || optionalText(product.name_cn) || optionalText(product.name_gr);
  const facts = [
    productName ? `Catalog product name: ${productName}.` : "",
    optionalText(product.category) ? `Category: ${optionalText(product.category)}.` : "",
    optionalText(product.subcategory) ? `Subcategory: ${optionalText(product.subcategory)}.` : "",
    optionalText(product.color) ? `Catalog color: ${optionalText(product.color)}.` : "",
    product.material_verified === true && optionalText(product.material) ? `Verified material: ${optionalText(product.material)}.` : "",
  ].filter(Boolean);

  return [
    "Create exactly one photorealistic ecommerce fashion image for a small clothing boutique.",
    "The uploaded images are authoritative references for the same garment. Garment identity is more important than artistic styling.",
    "Preserve the garment's exact visible color, pattern, print placement, silhouette, length, cut, neckline, sleeves, seams, buttons, zippers, pockets, texture, and other construction details.",
    "Do not redesign the garment. Do not add or remove logos, prints, decorations, fasteners, pockets, sleeves, or fabric details. If a detail is unclear in the references, keep it visually neutral instead of inventing it.",
    ...facts,
    `Use one ${modelType}. Show the referenced garment being worn and fully visible.`,
    "Use a natural standing or subtle three-quarter pose. Keep the model centered with comfortable margins; do not crop the garment, head, hands, or feet when a full-body composition is appropriate.",
    "Any supporting garments or accessories must be simple, neutral, unbranded, and must not cover the referenced garment.",
    `Visual direction: ${style}.`,
    "Scene: clean Mediterranean boutique or understated Athens street setting, natural light, realistic skin and fabric texture, commercial fashion photography.",
    "Composition: vertical 2:3 portrait, single adult model, no extra people, no collage, no duplicated body parts.",
    "Do not include text, prices, discount labels, borders, logos, watermarks, or invented branding.",
    "The result is a styling reference image for the product gallery, not a replacement for the original product photo.",
  ].join("\n");
}

function allowedImageOrigins() {
  const storageOrigin = configuredStorageOrigin();
  const explicit = (process.env.SERVER_IMAGE_FETCH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return { storageOrigin, origins: Array.from(new Set([storageOrigin, ...explicit].filter(Boolean))) };
}

async function loadSourceImage(url: string, index: number) {
  const { storageOrigin, origins } = allowedImageOrigins();
  if (!storageOrigin || origins.length === 0) throw new Error("Customer Storage origin is not configured.");
  try {
    const downloaded = await downloadRemoteImage(url, {
      allowedOrigins: origins,
      storageOrigin,
      maxBytes: maxSourceImageBytes,
      timeoutMs: 20_000,
      maxRedirects: 3,
    });
    const normalized = await optimizeUploadedImage(downloaded.buffer, {
      declaredMimeType: downloaded.contentType,
      maxBytes: maxSourceImageBytes,
      maxPixels: maxSourcePixels,
      maxWidth: maxSourceDimension,
      maxHeight: maxSourceDimension,
      resize: { width: 1600, height: 1600, fit: "inside" },
      quality: 90,
    });
    return {
      blob: new Blob([new Uint8Array(normalized.buffer)], { type: "image/webp" }),
      filename: `reference-${index + 1}.webp`,
    };
  } catch (error) {
    throw new Error(`Reference image ${index + 1} was rejected: ${error instanceof Error ? error.message : "unsupported image"}`);
  }
}

async function ensurePublicBucket(supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await supabase.storage.getBucket(productImagesBucket);
  if (error || !data) return new Error("The product-images bucket is not installed.");
  const allowedMimeTypes = Array.isArray(data.allowed_mime_types) ? data.allowed_mime_types : [];
  if (
    data.public !== true
    || Number(data.file_size_limit || 0) !== 10 * 1024 * 1024
    || !["image/jpeg", "image/png", "image/webp"].every((mime) => allowedMimeTypes.includes(mime))
  ) return new Error("The product-images bucket security configuration is incomplete.");
  return null;
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "ai:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("ai_tools"))) return featureDisabledResponse("ai_tools");

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured. Add it before generating AI styling images." },
      { status: 500 },
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const style = typeof payload.style === "string" && payload.style.trim() ? payload.style.trim() : "Mediterranean boutique street style";
  const modelType = typeof payload.modelType === "string" && payload.modelType.trim() ? payload.modelType.trim() : "adult fashion model";

  if (!sku) return NextResponse.json({ error: "SKU is required" }, { status: 400 });

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .maybeSingle();

  if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const productRecord = product as Record<string, unknown>;
  const galleryUrls = Array.isArray(productRecord.image_urls)
    ? productRecord.image_urls.filter(isHttpUrl)
    : [];
  const sourceImages = [productRecord.image_url, ...galleryUrls].filter(isHttpUrl).slice(0, maxSourceImages);

  if (sourceImages.length === 0) {
    return NextResponse.json(
      { error: "Please upload at least one real product photo before generating an AI styling image." },
      { status: 400 },
    );
  }

  const prompt = buildStyleImagePrompt(productRecord, modelType, style);
  const imageModel = (process.env.OPENAI_IMAGE_MODEL || imageModelFallback).trim() || imageModelFallback;

  let sourceFiles: Awaited<ReturnType<typeof loadSourceImage>>[];
  try {
    sourceFiles = await Promise.all(sourceImages.map(loadSourceImage));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reference images could not be prepared." },
      { status: 400 },
    );
  }

  const form = new FormData();
  form.append("model", imageModel);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", imageSize);
  form.append("quality", imageQuality);
  form.append("output_format", imageOutputFormat);
  form.append("output_compression", String(imageOutputCompression));
  for (const sourceFile of sourceFiles) {
    form.append("image[]", sourceFile.blob, sourceFile.filename);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error?.message || "AI image generation failed";
    return NextResponse.json({ error: message }, { status: response.status });
  }

  const b64 = result?.data?.[0]?.b64_json;
  if (!b64 || typeof b64 !== "string") {
    return NextResponse.json({ error: "AI image response did not include image data." }, { status: 500 });
  }

  const imageBuffer = Buffer.from(b64, "base64");
  let validatedOutput;
  try {
    validatedOutput = await optimizeUploadedImage(imageBuffer, {
      declaredMimeType: "image/webp",
      maxBytes: maxSourceImageBytes,
      maxPixels: maxSourcePixels,
      maxWidth: maxSourceDimension,
      maxHeight: maxSourceDimension,
      quality: imageOutputCompression,
    });
  } catch (error) {
    return NextResponse.json({ error: "AI image response was not a valid image." }, { status: 502 });
  }
  if (validatedOutput.width !== imageWidth || validatedOutput.height !== imageHeight) {
    return NextResponse.json(
      {
        error: `AI image output did not match the required ${imageSize} ${imageOutputFormat.toUpperCase()} standard.`,
        received: {
          width: validatedOutput.width || null,
          height: validatedOutput.height || null,
          format: validatedOutput.format || null,
        },
      },
      { status: 502 },
    );
  }

  const bucketError = await ensurePublicBucket(supabase);
  if (bucketError) return NextResponse.json({ error: bucketError.message }, { status: 500 });

  const productId = Number(productRecord.id);
  const operationId = randomUUID();
  const path = productStoragePath(productId, sku, "ai", operationId);
  const { data: publicUrlData } = supabase.storage.from(productImagesBucket).getPublicUrl(path);
  const imageUrl = withCacheVersion(publicUrlData.publicUrl);
  const currentGallery = Array.isArray(productRecord.image_urls)
    ? productRecord.image_urls.filter(isHttpUrl)
    : [];
  const nextGallery = Array.from(new Set([...currentGallery, imageUrl]));

  try {
    await uploadAndCommitStorageObject({
      backend: createSupabaseStorageLifecycleBackend(supabase),
      object: {
        operationId,
        bucket: productImagesBucket,
        path,
        ownerType: "product",
        ownerKey: String(productId),
        reason: "ai_style_image_upload",
      },
      body: validatedOutput.buffer,
      contentType: "image/webp",
      commitReference: async () => {
        const { data, error } = await (supabase as any)
          .from("products")
          .update({ image_urls: nextGallery })
          .eq("id", productId)
          .eq("sku", sku)
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message || "AI image reference was not committed.");
      },
    });
  } catch (error) {
    const status = error instanceof ImageValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI image storage commit failed." }, { status });
  }

  invalidateProductsCache(sku);

  return NextResponse.json({
    ok: true,
    imageUrl,
    image: {
      model: imageModel,
      quality: imageQuality,
      width: validatedOutput.width,
      height: validatedOutput.height,
      format: validatedOutput.format,
    },
    note: "AI styling image generated as a reference image and appended to the product gallery.",
  });
}
