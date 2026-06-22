/** Slug normalization — for category/subcategory matching */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** Match product category against a target slug, case-insensitive */
export function categoryMatches(productCategory: string | null, target: string): boolean {
  if (!productCategory) return false;
  return normalizeSlug(productCategory) === normalizeSlug(target);
}

/** Match product subcategory against a target slug */
export function subcategoryMatches(productSub: string | null, target: string): boolean {
  if (!productSub) return false;
  return normalizeSlug(productSub) === normalizeSlug(target);
}
