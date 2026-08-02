import { revalidatePath, revalidateTag } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";

export function invalidateProductsCache(sku?: string | null) {
  revalidateTag(cacheTags.products);
  revalidateTag(cacheTags.product);
  revalidatePath("/");
  revalidatePath("/sitemap.xml");

  if (sku) {
    revalidatePath(`/product/${encodeURIComponent(sku)}`);
  }
}

export function invalidateSettingsCache() {
  revalidateTag(cacheTags.settings);
  revalidatePath("/");
  revalidatePath("/contact");
  revalidatePath("/sitemap.xml");
}

export function invalidateCategoriesCache() {
  revalidateTag(cacheTags.categories);
  revalidateTag(cacheTags.products);
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
}
