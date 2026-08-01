/**
 * Category data loader — reads from product_categories table,
 * falls back to hardcoded categories if table doesn't exist yet.
 */

import { unstable_cache } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";
import { getSupabaseClient } from "@/lib/supabase";
import type { ProductCategory } from "@/lib/types";

export interface DbCategory {
  id: string; slug: string; name_cn: string; name_en: string; name_gr: string;
  image_url: string | null; sort_order: number; is_active: boolean;
}
export interface DbSubcategory {
  id: string; category_id: string; slug: string; name_cn: string; name_en: string; name_gr: string;
  sort_order: number; is_active: boolean;
}

type CatMap = Record<string, DbCategory>;
type SubMap = Record<string, DbSubcategory[]>;

const CATEGORY_SELECT = "id,slug,name_cn,name_en,name_gr,image_url,sort_order,is_active";
const SUBCATEGORY_SELECT = "id,category_id,slug,name_cn,name_en,name_gr,sort_order,is_active";

async function loadCategoriesRaw(): Promise<{ cats: CatMap; subs: SubMap }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { cats: {}, subs: {} };

  try {
    const [cr, sr] = await Promise.all([
      (supabase as any).from("product_categories").select(CATEGORY_SELECT).eq("is_active", true).order("sort_order"),
      (supabase as any).from("product_subcategories").select(SUBCATEGORY_SELECT).eq("is_active", true).order("sort_order"),
    ]);
    if (cr.error || sr.error) return { cats: {}, subs: {} };
    const cats: CatMap = {};
    if (cr.data) for (const c of cr.data) cats[c.slug] = c as DbCategory;
    const subs: SubMap = {};
    if (sr.data) for (const s of sr.data) {
      const slug = (cats as any)[Object.keys(cats).find(k => (cats as any)[k].id === s.category_id) || ""]?.slug || "";
      if (!subs[slug]) subs[slug] = [];
      subs[slug].push(s as DbSubcategory);
    }
    return { cats, subs };
  } catch { return { cats: {}, subs: {} }; }
}

const loadCategoriesCached = unstable_cache(
  loadCategoriesRaw,
  ["product-categories"],
  { revalidate: 3600, tags: [cacheTags.categories] },
);

export async function loadCategories(): Promise<{ cats: CatMap; subs: SubMap }> {
  return loadCategoriesCached();
}

export function getCategoryLabel(cat: DbCategory | undefined, lang: "el" | "en", fallback: string): string {
  if (!cat) return fallback;
  return (lang === "en" ? cat.name_en : cat.name_gr) || cat.name_en || cat.name_cn || cat.slug;
}

export function getSubcategoryLabel(sub: DbSubcategory | undefined, lang: "el" | "en", fallback: string): string {
  if (!sub) return fallback;
  return (lang === "en" ? sub.name_en : sub.name_gr) || sub.name_en || sub.name_cn || sub.slug;
}

export function getCategorySlugs(cats: CatMap): ProductCategory[] {
  const slugs = Object.keys(cats).filter(s => cats[s].is_active);
  if (slugs.length > 0) return slugs as ProductCategory[];
  // fallback to hardcoded
  return ["women", "men", "shoes", "bags", "luggage", "hats", "jewelry", "other"];
}

export function getSubcategorySlugs(subs: SubMap, categorySlug: string): string[] {
  const list = subs[categorySlug];
  if (list && list.length > 0) return list.filter(s => s.is_active).map(s => s.slug);
  return [];
}
