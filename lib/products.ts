import { getSupabaseClient } from "./supabase";
import type { Product, ProductCategory } from "./types";

export type ProductsResult = {
  products: Product[];
  error: string | null;
};

function mapProduct(product: Product): Product {
  return {
    ...product,
    price: Number(product.price),
    stock: Number(product.stock)
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

export async function getProductsByCategory(category: ProductCategory): Promise<ProductsResult> {
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
    .eq("category", category)
    .order("created_at", { ascending: false });

  if (error) {
    return { products: [], error: error.message };
  }

  return { products: (data || []).map(mapProduct), error: null };
}
