import { unstable_cache } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";
import { getTotalStock } from "@/lib/product-stock";
import {
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
} from "@/lib/product-data-boundary";
import { getSupabaseClient } from "./supabase";
import { isProductSubcategory, type Product, type ProductCategory } from "./types";
import { publicVariantOptions, type PublicProductVariant } from "./product-variant-matrix";

export type ProductsResult = {
  products: Product[];
  error: string | null;
  total?: number;
  page?: number;
  pageSize?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
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
  subcategory?: string,
  page = 1,
  pageSize = 48,
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
  const normalizedPage = Math.max(1, Math.trunc(Number(page) || 1));
  const limit = Math.min(96, Math.max(12, Math.trunc(Number(pageSize) || 48)));
  const offset = (normalizedPage - 1) * limit;

  let query = supabase
    .from("products")
    .select(PUBLIC_PRODUCT_LIST_SELECT, { count: "exact" })
    .ilike("category", normalizedCategory)
    .or("is_active.is.null,is_active.eq.true")
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (normalizedSubcategory && isProductSubcategory(normalizedCategory, normalizedSubcategory)) {
    query = query.ilike("subcategory", normalizedSubcategory);
  }

  const { data, error, count } = await query;

  if (error) {
    return { products: [], error: error.message };
  }

  const rows = (data || []) as unknown as Product[];
  const filtered = rows.filter((p) => !isClearlyTestProduct(p));

  const total = Number(count || 0);
  return {
    products: filtered.map(mapProduct),
    error: null,
    total,
    page: normalizedPage,
    pageSize: limit,
    hasNextPage: offset + limit < total,
    hasPreviousPage: normalizedPage > 1,
  };
}

const getProductsByCategoryCached = unstable_cache(
  getProductsByCategoryRaw,
  ["products-by-category"],
  { revalidate: 300, tags: [cacheTags.products] },
);

export async function getProductsByCategory(
  category: ProductCategory,
  subcategory?: string,
  page = 1,
  pageSize = 48,
): Promise<ProductsResult> {
  return getProductsByCategoryCached(category, subcategory, page, pageSize);
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
  if (!data) return { product: null, error: null };

  const product = mapProduct(data as unknown as Product);
  const { data: publicVariants, error: variantError } = await (supabase as any).rpc(
    "product_public_variants_rpc",
    { p_product_sku: sku },
  );
  if (!variantError) {
    product.public_variants = publicVariantOptions(publicVariants).map(variant => ({
      size: variant.size,
      color: variant.color,
      quantity_available: variant.quantityAvailable,
      price: variant.unitPrice,
    }));
  }
  return { product, error: null };
}

const getProductBySkuCached = unstable_cache(
  getProductBySkuRaw,
  ["product-by-sku"],
  { revalidate: 300, tags: [cacheTags.products, cacheTags.product] },
);

export async function getProductBySku(sku: string): Promise<{ product: Product | null; error: string | null }> {
  return getProductBySkuCached(sku);
}

/**
 * Inventory availability is intentionally uncached. Product metadata may use
 * the five-minute catalog cache, but a shopper's size/color choices must be
 * based on the current MAIN_STORE balance minus active reservations.
 */
export async function getCurrentPublicVariantsBySku(
  sku: string,
): Promise<{ variants: PublicProductVariant[]; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { variants: [], error: "Inventory availability is not configured." };
  const { data, error } = await (supabase as any).rpc("product_public_variants_rpc", {
    p_product_sku: sku,
  });
  if (error) return { variants: [], error: error.message };
  return { variants: publicVariantOptions(data), error: null };
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
