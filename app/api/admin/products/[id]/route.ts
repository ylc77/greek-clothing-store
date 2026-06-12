import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid, productForForm, validateProductPayload } from "@/lib/admin-products";
import { removeProductStorageImages } from "@/lib/storage-images";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

type ProductRouteContext = {
  params: Promise<{
    id: string;
  }>;
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

function isAuthorized(request: NextRequest) {
  return adminPasswordIsValid(request.headers.get("x-admin-password"));
}

export async function PUT(request: NextRequest, context: ProductRouteContext) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const { id } = await context.params;
  const payload = await request.json();
  const { errors, mutation } = validateProductPayload(payload);

  if (!mutation) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("products")
    .update(mutation)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product: productForForm(data as Product) });
}

export async function DELETE(request: NextRequest, context: ProductRouteContext) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const { id } = await context.params;
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("sku, image_url, image_urls")
    .eq("id", id)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }

  if (product) {
    await removeProductStorageImages(supabase, product as Pick<Product, "sku" | "image_url" | "image_urls">);
  }

  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
