import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { invalidateProductsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { productImagesBucket, storageSkuSegment } from "@/lib/storage-images";

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

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

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

async function loadSourceImage(url: string, index: number) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Reference image ${index + 1} could not be downloaded (${response.status}).`);
  }

  const declaredBytes = Number(response.headers.get("content-length")) || 0;
  if (declaredBytes > maxSourceImageBytes) {
    throw new Error(`Reference image ${index + 1} is larger than 15 MB.`);
  }

  const source = Buffer.from(await response.arrayBuffer());
  if (source.length === 0 || source.length > maxSourceImageBytes) {
    throw new Error(`Reference image ${index + 1} is empty or larger than 15 MB.`);
  }

  try {
    const normalized = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    return {
      blob: new Blob([new Uint8Array(normalized)], { type: "image/webp" }),
      filename: `reference-${index + 1}.webp`,
    };
  } catch {
    throw new Error(`Reference image ${index + 1} is not a supported or valid image.`);
  }
}

async function ensurePublicBucket(supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await supabase.storage.getBucket(productImagesBucket);
  if (!data && error) {
    const { error: createError } = await supabase.storage.createBucket(productImagesBucket, { public: true });
    return createError;
  }
  if (data && !data.public) {
    const { error: updateError } = await supabase.storage.updateBucket(productImagesBucket, { public: true });
    return updateError;
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "ai:write"))) return unauthorized();
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
  let outputMetadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    outputMetadata = await sharp(imageBuffer).metadata();
  } catch {
    return NextResponse.json({ error: "AI image response was not a valid image." }, { status: 502 });
  }
  if (outputMetadata.format !== imageOutputFormat || outputMetadata.width !== imageWidth || outputMetadata.height !== imageHeight) {
    return NextResponse.json(
      {
        error: `AI image output did not match the required ${imageSize} ${imageOutputFormat.toUpperCase()} standard.`,
        received: {
          width: outputMetadata.width || null,
          height: outputMetadata.height || null,
          format: outputMetadata.format || null,
        },
      },
      { status: 502 },
    );
  }

  const bucketError = await ensurePublicBucket(supabase);
  if (bucketError) return NextResponse.json({ error: bucketError.message }, { status: 500 });

  const safeSku = storageSkuSegment(sku);
  const path = `products/${safeSku}/ai/styling-${Date.now()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from(productImagesBucket)
    .upload(path, imageBuffer, { contentType: "image/webp", cacheControl: "31536000", upsert: true });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: publicUrlData } = supabase.storage.from(productImagesBucket).getPublicUrl(path);
  const imageUrl = withCacheVersion(publicUrlData.publicUrl);
  const currentGallery = Array.isArray(productRecord.image_urls)
    ? productRecord.image_urls.filter(isHttpUrl)
    : [];
  const nextGallery = Array.from(new Set([...currentGallery, imageUrl]));

  const { error: updateError } = await supabase
    .from("products")
    .update({ image_urls: nextGallery })
    .eq("sku", sku);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  invalidateProductsCache(sku);

  return NextResponse.json({
    ok: true,
    imageUrl,
    image: {
      model: imageModel,
      quality: imageQuality,
      width: outputMetadata.width,
      height: outputMetadata.height,
      format: outputMetadata.format,
    },
    note: "AI styling image generated as a reference image and appended to the product gallery.",
  });
}
