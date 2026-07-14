import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { developerRequestIsAuthorized } from "@/lib/developer-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";

const bucket = "product-images"; // reuse existing bucket, store under store/ folder

export async function POST(request: NextRequest) {
  const developerAuthorized = await developerRequestIsAuthorized(request);
  const catalogAuthorized = developerAuthorized
    ? false
    : await adminRequestHasPermissionAsync(request, "categories:write");
  if (!developerAuthorized && !catalogAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin client not configured" }, { status: 500 });
  }

  // Ensure bucket exists and is public
  const { error: bucketError } = await supabase.storage.getBucket(bucket);
  if (bucketError) {
    await supabase.storage.createBucket(bucket, { public: true });
  } else {
    await supabase.storage.updateBucket(bucket, { public: true });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string | null; // "logo" or "hero"

  if (!file || !name) {
    return NextResponse.json({ error: "Missing file or name" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File is not an image" }, { status: 400 });
  }

  // Compress to WebP using sharp if available
  let buffer: Buffer;
  let contentType = file.type;
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(await file.arrayBuffer());
    buffer = await sharp(input)
      .resize(name === "logo" ? { width: 200, height: 80, fit: "inside", withoutEnlargement: true } : { width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    contentType = "image/webp";
  } catch {
    // sharp may not be available or file may not be processable — use original
    buffer = Buffer.from(await file.arrayBuffer());
  }

  const ts = Date.now();
  const path = `store/${name}-${ts}.${contentType === "image/webp" ? "webp" : file.name.split(".").pop()}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { contentType, cacheControl: "31536000", upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = publicUrlData.publicUrl;

  return NextResponse.json({ url });
}
