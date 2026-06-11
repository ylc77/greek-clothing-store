import { getSupabaseClient } from "./supabase";
import { isProductSubcategory, type Product, type ProductCategory } from "./types";

export type ProductsResult = {
  products: Product[];
  error: string | null;
};

function mapProduct(product: Product): Product {
  return {
    ...product,
    price: Number(product.price),
    stock: Number(product.stock),
    image_urls: Array.isArray(product.image_urls) ? product.image_urls : []
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
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { products: [], error: error.message };
  }

  return { products: (data || []).map(mapProduct), error: null };
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
    .eq("category", category)
    .order("created_at", { ascending: false });

  if (subcategory && isProductSubcategory(category, subcategory)) {
    query = query.eq("subcategory", subcategory);
  }

  const { data, error } = await query;

  if (error) {
    return { products: [], error: error.message };
  }

  return { products: (data || []).map(mapProduct), error: null };
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
