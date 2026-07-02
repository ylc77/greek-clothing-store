import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { productImagesBucket, storageSkuSegment } from "@/lib/storage-images";

export const runtime = "nodejs";

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
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauthorized();

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
  const sourceImages = [productRecord.image_url, ...galleryUrls].filter(isHttpUrl).slice(0, 4);

  if (sourceImages.length === 0) {
    return NextResponse.json(
      { error: "Please upload at least one real product photo before generating an AI styling image." },
      { status: 400 },
    );
  }

  const prompt = [
    "Create a realistic ecommerce styling reference image for a small clothing boutique.",
    "Use the uploaded garment photos as the clothing reference. Preserve the garment color, silhouette, and visible details as much as possible.",
    `Model: ${modelType}.`,
    `Style: ${style}.`,
    "Scene: clean Mediterranean boutique or Athens street style, natural light, tasteful commercial fashion photography.",
    "Show the garment worn by the model. Do not add logos, text, watermarks, or misleading discount labels.",
    "This image is a styling reference, not the official product photo.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      images: sourceImages.map((image_url) => ({ image_url })),
      prompt,
      n: 1,
      size: "1024x1536",
      output_format: "webp",
      output_compression: 85,
    }),
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

  const bucketError = await ensurePublicBucket(supabase);
  if (bucketError) return NextResponse.json({ error: bucketError.message }, { status: 500 });

  const safeSku = storageSkuSegment(sku);
  const path = `products/${safeSku}/ai/styling-${Date.now()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from(productImagesBucket)
    .upload(path, Buffer.from(b64, "base64"), { contentType: "image/webp", cacheControl: "31536000", upsert: true });

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
    note: "AI styling image generated as a reference image and appended to the product gallery.",
  });
}
