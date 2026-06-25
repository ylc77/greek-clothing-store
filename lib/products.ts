import { getSupabaseClient } from "./supabase";
import { isProductSubcategory, type Product, type ProductCategory } from "./types";

export type ProductsResult = {
  products: Product[];
  error: string | null;
};

import { getTotalStock } from "@/lib/product-stock";

/** @deprecated Use getTotalStock from lib/product-stock.ts instead */
export const effectiveStock = getTotalStock;

function normalizeSlug(value: string) {
  return value.trim().toLowerCase();
}

function isClearlyTestProduct(product: Product) {
  const sku = product.sku.trim().toUpperCase();
  return (
    sku === "TEST" ||
    sku.startsWith("TEST-") ||
    sku.startsWith("TEST_") ||
    sku === "DEMO" ||
    sku.startsWith("DEMO-") ||
    sku.startsWith("DEMO_")
  );
}

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
    .or("is_active.is.null,is_active.eq.true")
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(limit * 2); // fetch extra to account for test product filtering

  if (error) {
    return { products: [], error: error.message };
  }

  const filtered = (data || []).filter((p: Product) => !isClearlyTestProduct(p));

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

  const normalizedCategory = normalizeSlug(category);
  const normalizedSubcategory = subcategory ? normalizeSlug(subcategory) : undefined;

  let query = supabase
    .from("products")
    .select("*")
    .ilike("category", normalizedCategory)
    .or("is_active.is.null,is_active.eq.true")
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(200);

  if (normalizedSubcategory && isProductSubcategory(normalizedCategory, normalizedSubcategory)) {
    query = query.ilike("subcategory", normalizedSubcategory);
  }

  const { data, error } = await query;

  if (error) {
    return { products: [], error: error.message };
  }

  const filtered = (data || []).filter((p: Product) => !isClearlyTestProduct(p));

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

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .or("is_active.is.null,is_active.eq.true")
    .maybeSingle();

  if (error) {
    return { product: null, error: error.message };
  }

  return { product: data ? mapProduct(data as Product) : null, error: null };
}

/** Static category cover images — independent of product uploads. */
const CATEGORY_COVER_MAP: Record<string, string> = {
  men: "/images/category/men.jpg",
  women: "/images/category/women.jpg",
  shoes: "/images/category/shoes.jpg",
  bags: "/images/category/bags.jpg",
  luggage: "/images/category/luggage.jpg",
  hats: "/images/category/hats.jpg",
  jewelry: "/images/category/jewelry.jpg",
  other: "/images/category/other.jpg",
};

export function getCategoryImages(): Record<string, string> {
  return { ...CATEGORY_COVER_MAP };
}
