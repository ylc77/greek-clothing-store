import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const bucketName = "product-images";
const imageNamePattern = /^(.+)\.(jpe?g|png|webp)$/i;
const galleryImageNamePattern = /^(.+)-([1-9]\d*)\.(jpe?g|png|webp)$/i;
const webpContentType = "image/webp";

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

function storageSkuSegment(sku: string) {
  return sku.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function storagePathFor(sku: string, galleryIndex: number | null) {
  const safeSku = storageSkuSegment(sku);
  return galleryIndex === null
    ? `products/${safeSku}/main.webp`
    : `products/${safeSku}/gallery/${galleryIndex + 1}.webp`;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

async function toOptimizedWebp(file: File) {
  const input = Buffer.from(await file.arrayBuffer());

  if (file.type === webpContentType || file.name.toLowerCase().endsWith(".webp")) {
    return input;
  }

  const { default: sharp } = await import("sharp");
  return sharp(input)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

async function ensurePublicBucket(supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await supabase.storage.getBucket(bucketName);

  if (!data && error) {
    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: true
    });
    return createError;
  }

  if (data && !data.public) {
    const { error: updateError } = await supabase.storage.updateBucket(bucketName, {
      public: true
    });
    return updateError;
  }

  return null;
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
        ? currentImageUrls.length
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
    const { error: uploadError } = await supabase.storage.from(bucketName).upload(storagePath, webpBuffer, {
      upsert: true,
      contentType: webpContentType
    });

    if (uploadError) {
      results.push({ fileName, sku, ok: false, message: uploadError.message });
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(storagePath);
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
