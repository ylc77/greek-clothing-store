import { getSupabaseClient } from "./supabase";
import { isProductSubcategory, type Product, type ProductCategory } from "./types";

export type ProductsResult = {
  products: Product[];
  error: string | null;
};

import { getTotalStock } from "@/lib/product-stock";

/** @deprecated Use getTotalStock from lib/product-stock.ts instead */
export const effectiveStock = getTotalStock;

function mapProduct(product: Product): Product {
  return {
    ...product,
    price: Number(product.price),
    stock: Number(product.stock),
    image_urls: Array.isArray(product.image_urls) ? product.image_urls : [],
    size_stock: (product as Record<string, unknown>).size_stock as Record<string, number> | null | undefined,
  };
}

export async function getLatestProducts(limit = 8): Promise<ProductsResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      products: [],
      error: "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .neq("is_active", false)
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(limit * 2); // fetch extra to account for test product filtering

  if (error) {
    return { products: [], error: error.message };
  }

  // Filter out test products: SKU or name looks like test data
  const filtered = (data || []).filter(
    (p: Product) => {
      if (/(?:^|[_-])test(?:[_-]|$)/i.test(p.sku)) return false;
      if (/(?:^|[_-])demo(?:[_-]|$)/i.test(p.sku)) return false;
      // Filter out products whose only name is numeric (like "111")
      const gr = (p.name_gr || "").trim();
      const en = (p.name_en || "").trim();
      const cn = (p.name_cn || "").trim();
      const anyName = [gr, en, cn].filter(Boolean);
      if (anyName.length > 0 && anyName.every(n => /^[\d\s.-]+$/.test(n))) return false;
      return true;
    },
  );

  return { products: filtered.slice(0, limit).map(mapProduct), error: null };
}

export async function getProductsByCategory(
  category: ProductCategory,
  subcategory?: string
): Promise<ProductsResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      products: [],
      error: "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
    };
  }

  let query = supabase
    .from("products")
    .select("*")
    .ilike("category", category)
    .neq("is_active", false)
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(200);

  if (subcategory && isProductSubcategory(category, subcategory)) {
    query = query.ilike("subcategory", subcategory);
  }

  const { data, error } = await query;

  if (error) {
    return { products: [], error: error.message };
  }

  const filtered = (data || []).filter((p: Product) => {
    if (/(?:^|[_-])test(?:[_-]|$)/i.test(p.sku)) return false;
    if (/(?:^|[_-])demo(?:[_-]|$)/i.test(p.sku)) return false;
    return true;
  });

  return { products: filtered.map(mapProduct), error: null };
}

export async function getProductBySku(sku: string): Promise<{ product: Product | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      product: null,
      error: "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
    };
  }

  const { data, error } = await supabase.from("products").select("*").eq("sku", sku).maybeSingle();

  if (error) {
    return { product: null, error: error.message };
  }

  return { product: data ? mapProduct(data as Product) : null, error: null };
}

/** Static category cover images — independent of product uploads. */
const CATEGORY_COVER_MAP: Record<string, string> = {
  men: "/images/category/men.svg",
  women: "/images/category/women.svg",
  shoes: "/images/category/shoes.svg",
  bags: "/images/category/bags.svg",
  luggage: "/images/category/luggage.svg",
  hats: "/images/category/hats.svg",
  jewelry: "/images/category/jewelry.svg",
  other: "/images/category/other.svg",
};

export function getCategoryImages(): Record<string, string> {
  return { ...CATEGORY_COVER_MAP };
}
