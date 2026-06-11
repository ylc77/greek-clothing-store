import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { getSupabaseAdminClient } from "@/lib/supabase";

const bucketName = "product-images";
const imageNamePattern = /^(.+)\.(jpg|png|webp)$/i;

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

function contentTypeFor(fileName: string, fallback: string) {
  if (fallback) {
    return fallback;
  }

  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
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
  const results: ImageResult[] = [];

  for (const file of files) {
    const fileName = file.name.trim();
    const match = fileName.match(imageNamePattern);

    if (!match) {
      results.push({
        fileName,
        sku: "",
        ok: false,
        message: "File name must be sku.jpg, sku.png, or sku.webp"
      });
      continue;
    }

    const sku = match[1];
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, sku")
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

    const { error: uploadError } = await supabase.storage.from(bucketName).upload(fileName, file, {
      upsert: true,
      contentType: contentTypeFor(fileName, file.type)
    });

    if (uploadError) {
      results.push({ fileName, sku, ok: false, message: uploadError.message });
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
    const imageUrl = publicUrlData.publicUrl;
    const { error: updateError } = await supabase
      .from("products")
      .update({ image_url: imageUrl })
      .eq("sku", sku);

    if (updateError) {
      results.push({ fileName, sku, ok: false, message: updateError.message });
      continue;
    }

    results.push({
      fileName,
      sku,
      ok: true,
      message: "Uploaded and linked",
      imageUrl
    });
  }

  return NextResponse.json({
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    results
  });
}
