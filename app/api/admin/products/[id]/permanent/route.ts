import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauthorized();

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin client not configured" }, { status: 500 });

  const { id } = await context.params;

  // Fetch product to get image URLs for storage cleanup
  const { data: product } = await (supabase as any)
    .from("products")
    .select("sku, image_url, image_urls")
    .eq("id", id)
    .maybeSingle();

  // Delete from database
  const { error } = await (supabase as any).from("products").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateProductsCache(product?.sku as string | undefined);

  // Try to clean up storage images (non-blocking)
  if (product) {
    const { sku, image_url, image_urls } = product;
    const paths: string[] = [];
    // Derive storage paths from SKU
    if (image_url) {
      const match = image_url.match(/\/products\/([^/]+)\/([^?]+)/);
      if (match) paths.push(`products/${match[1]}/${match[2]}`);
    }
    if (Array.isArray(image_urls)) {
      for (const url of image_urls) {
        const m = (url as string).match(/\/products\/([^/]+)\/([^?]+)/);
        if (m) paths.push(`products/${m[1]}/${m[2]}`);
      }
    }
    if (paths.length > 0) {
      try { await supabase.storage.from("product-images").remove(paths); } catch { /* non-blocking */ }
    }
  }

  return NextResponse.json({ ok: true });
}
