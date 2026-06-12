import type { getSupabaseAdminClient } from "./supabase";
import type { Product } from "./types";

export const productImagesBucket = "product-images";

type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

export function storageSkuSegment(sku: string) {
  return sku.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function storagePathFor(sku: string, galleryIndex: number | null) {
  const safeSku = storageSkuSegment(sku);
  return galleryIndex === null
    ? `products/${safeSku}/main.webp`
    : `products/${safeSku}/gallery/${galleryIndex + 1}.webp`;
}

export function storagePathFromPublicUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  const marker = `/storage/v1/object/public/${productImagesBucket}/`;
  const markerIndex = url.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  return decodeURIComponent(url.slice(markerIndex + marker.length).split("?")[0]);
}

export async function removeStoragePaths(supabase: SupabaseAdminClient, paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));

  if (uniquePaths.length === 0) {
    return null;
  }

  const { error } = await supabase.storage.from(productImagesBucket).remove(uniquePaths);
  return error;
}

export async function listProductStoragePaths(supabase: SupabaseAdminClient, sku: string) {
  const safeSku = storageSkuSegment(sku);
  const paths = [storagePathFor(sku, null)];
  const { data } = await supabase.storage.from(productImagesBucket).list(`products/${safeSku}/gallery`, {
    limit: 100
  });

  for (const item of data || []) {
    if (item.name) {
      paths.push(`products/${safeSku}/gallery/${item.name}`);
    }
  }

  return Array.from(new Set(paths));
}

export async function removeProductStorageImages(supabase: SupabaseAdminClient, product: Pick<Product, "sku" | "image_url" | "image_urls">) {
  const urlPaths = [
    storagePathFromPublicUrl(product.image_url),
    ...(Array.isArray(product.image_urls) ? product.image_urls.map(storagePathFromPublicUrl) : [])
  ].filter((path): path is string => Boolean(path));
  const listedPaths = await listProductStoragePaths(supabase, product.sku);

  return removeStoragePaths(supabase, [...urlPaths, ...listedPaths]);
}
