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
const outputWidth = 1200;
const outputHeight = 1500;

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

async function toOptimizedWebp(file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  const { default: sharp } = await import("sharp");

  try {
    return await sharp(input)
      .rotate()
      .resize({
        width: outputWidth,
        height: outputHeight,
        fit: "cover",
        position: "centre"
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    if (file.type === webpContentType || file.name.toLowerCase().endsWith(".webp")) {
      return input;
    }

    throw error;
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

    let webpBuffer: Buffer;
    try {
      webpBuffer = await toOptimizedWebp(file);
    } catch {
      results.push({ fileName, sku, ok: false, message: "Image could not be converted to WebP" });
      continue;
    }

    const storagePath = storagePathFor(sku, galleryIndex);
    const { error: uploadError } = await supabase.storage.from(productImagesBucket).upload(storagePath, webpBuffer, {
      upsert: true,
      contentType: webpContentType
    });

    if (uploadError) {
      results.push({ fileName, sku, ok: false, message: uploadError.message });
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(productImagesBucket).getPublicUrl(storagePath);
    const imageUrl = publicUrlData.publicUrl;
    const updatePayload =
      galleryIndex === null
        ? { image_url: imageUrl }
        : {
            image_url: galleryIndex === 0 ? imageUrl : product.image_url || imageUrl,
            image_urls: (() => {
              const imageUrls = Array.isArray(product.image_urls) ? [...product.image_urls] : [];
              imageUrls[galleryIndex] = imageUrl;
              return imageUrls.filter(Boolean);
            })()
          };
    const { error: updateError } = await supabase.from("products").update(updatePayload).eq("sku", sku);

    if (updateError) {
      results.push({ fileName, sku, ok: false, message: updateError.message });
      continue;
    }

    results.push({
      fileName,
      sku,
      ok: true,
      message:
        galleryIndex === null
          ? "Converted to WebP and linked as main image"
          : "Converted to WebP and linked as gallery image",
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
