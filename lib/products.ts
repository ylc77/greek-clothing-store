import { unstable_cache } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";
import { getTotalStock } from "@/lib/product-stock";
import {
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
} from "@/lib/product-data-boundary";
import { getSupabaseClient } from "./supabase";
import { isProductSubcategory, type Product, type ProductCategory } from "./types";

export type ProductsResult = {
  products: Product[];
  error: string | null;
};

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

async function getLatestProductsRaw(limit = 8): Promise<ProductsResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      products: [],
      error: "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_LIST_SELECT)
    .or("is_active.is.null,is_active.eq.true")
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(limit * 2); // fetch extra to account for test product filtering

  if (error) {
    return { products: [], error: error.message };
  }

  const rows = (data || []) as unknown as Product[];
  const filtered = rows.filter((p) => !isClearlyTestProduct(p));

  return { products: filtered.slice(0, limit).map(mapProduct), error: null };
}

const getLatestProductsCached = unstable_cache(
  getLatestProductsRaw,
  ["latest-products"],
  { revalidate: 300, tags: [cacheTags.products] },
);

export async function getLatestProducts(limit = 8): Promise<ProductsResult> {
  return getLatestProductsCached(limit);
}

async function getProductsByCategoryRaw(
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
    .select(PUBLIC_PRODUCT_LIST_SELECT)
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

  const rows = (data || []) as unknown as Product[];
  const filtered = rows.filter((p) => !isClearlyTestProduct(p));

  return { products: filtered.map(mapProduct), error: null };
}

const getProductsByCategoryCached = unstable_cache(
  getProductsByCategoryRaw,
  ["products-by-category"],
  { revalidate: 300, tags: [cacheTags.products] },
);

export async function getProductsByCategory(
  category: ProductCategory,
  subcategory?: string
): Promise<ProductsResult> {
  return getProductsByCategoryCached(category, subcategory);
}

async function getProductBySkuRaw(sku: string): Promise<{ product: Product | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      product: null,
      error: "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_DETAIL_SELECT)
    .eq("sku", sku)
    .or("is_active.is.null,is_active.eq.true")
    .maybeSingle();

  if (error) {
    return { product: null, error: error.message };
  }

  return { product: data ? mapProduct(data as unknown as Product) : null, error: null };
}

const getProductBySkuCached = unstable_cache(
  getProductBySkuRaw,
  ["product-by-sku"],
  { revalidate: 300, tags: [cacheTags.products, cacheTags.product] },
);

export async function getProductBySku(sku: string): Promise<{ product: Product | null; error: string | null }> {
  return getProductBySkuCached(sku);
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
