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
    .eq("is_active", true)
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { products: [], error: error.message };
  }

  // Filter out test products that have no Greek or English name
  const filtered = (data || []).filter(
    (p: Product) =>
      (p.name_gr && p.name_gr.trim()) || (p.name_en && p.name_en.trim()),
  );

  return { products: filtered.map(mapProduct), error: null };
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
    .eq("is_active", true)
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(200);

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

/** Fetch one product image per category (for category card backgrounds). */
export async function getCategoryImages(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const images: Record<string, string> = {};

  if (!supabase) return images;

  // Fetch latest active product with image per category using one query
  const { data } = await supabase
    .from("products")
    .select("category, image_url")
    .eq("is_active", true)
    .gte("stock", 0)
    .not("image_url", "is", null)
    .neq("image_url", "")
    .order("created_at", { ascending: false })
    .limit(50);

  if (data) {
    for (const row of data) {
      const cat = String(row.category);
      if (!images[cat] && row.image_url) {
        images[cat] = String(row.image_url);
      }
    }
  }

  return images;
}
