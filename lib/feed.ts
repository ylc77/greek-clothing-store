import { unstable_cache } from "next/cache";

import { cacheTags } from "@/lib/cache-tags";
import { SKROUTZ_PRODUCT_SELECT } from "@/lib/product-data-boundary";
import {
  assembleSkroutzFeedProducts,
  buildSkroutzFeed,
  type SkroutzBalanceRow,
  type SkroutzProductRow,
  type SkroutzVariantRow,
} from "@/lib/skroutz-feed";
import { siteUrl } from "@/lib/site";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";

export { buildSkroutzFeed } from "@/lib/skroutz-feed";
export type { SkroutzFeedProduct } from "@/lib/skroutz-feed";

export class SkroutzFeedUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkroutzFeedUnavailableError";
  }
}

type BalanceQueryRow = {
  variant_id: string;
  quantity_on_hand: number | string;
  quantity_reserved: number | string;
  inventory_locations: { code?: string } | Array<{ code?: string }> | null;
};

function locationCode(row: BalanceQueryRow) {
  const location = Array.isArray(row.inventory_locations)
    ? row.inventory_locations[0]
    : row.inventory_locations;
  return typeof location?.code === "string" ? location.code : "";
}

async function getFeedProductsRaw(
  minStock = 1,
  fallbackBrand = "Fashion Boutique",
  baseUrl = siteUrl(),
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new SkroutzFeedUnavailableError("Server-side Supabase credentials are unavailable.");
  }

  const productsResult = await fetchAllSupabaseRows<SkroutzProductRow>(async (from, to) => {
    const result = await (supabase as any)
      .from("products")
      .select(SKROUTZ_PRODUCT_SELECT)
      .or("is_active.is.null,is_active.eq.true")
      .order("id", { ascending: true })
      .range(from, to);
    return result;
  });
  if (productsResult.error) {
    throw new SkroutzFeedUnavailableError(`Product query failed: ${productsResult.error.message || "unknown error"}`);
  }

  const variantsResult = await fetchAllSupabaseRows<SkroutzVariantRow>(async (from, to) => {
    const result = await (supabase as any)
      .from("product_variants")
      .select("id,product_id,variant_sku,barcode,size,color,price,active")
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, to);
    return result;
  });
  if (variantsResult.error) {
    throw new SkroutzFeedUnavailableError(`Variant query failed: ${variantsResult.error.message || "unknown error"}`);
  }

  const balancesResult = await fetchAllSupabaseRows<BalanceQueryRow>(async (from, to) => {
    const result = await (supabase as any)
      .from("inventory_balances")
      .select("variant_id,quantity_on_hand,quantity_reserved,inventory_locations!inner(code)")
      .eq("inventory_locations.code", "MAIN_STORE")
      .order("variant_id", { ascending: true })
      .range(from, to);
    return result;
  });
  if (balancesResult.error) {
    throw new SkroutzFeedUnavailableError(`Inventory query failed: ${balancesResult.error.message || "unknown error"}`);
  }

  const balances: SkroutzBalanceRow[] = (balancesResult.data || []).map((row) => ({
    variant_id: row.variant_id,
    location_code: locationCode(row),
    quantity_on_hand: row.quantity_on_hand,
    quantity_reserved: row.quantity_reserved,
  }));

  return assembleSkroutzFeedProducts(
    productsResult.data || [],
    variantsResult.data || [],
    balances,
    minStock,
    baseUrl,
    fallbackBrand,
  );
}

const getFeedProductsCached = unstable_cache(
  getFeedProductsRaw,
  ["skroutz-feed-products-v2"],
  { revalidate: 300, tags: [cacheTags.products] },
);

export async function getFeedProducts(minStock = 1, fallbackBrand = "Fashion Boutique") {
  // The site origin is part of the cached function arguments so a domain or
  // Preview alias change cannot reuse feed rows containing stale product URLs.
  return getFeedProductsCached(minStock, fallbackBrand, siteUrl());
}

export function renderSkroutzFeed(
  products: Awaited<ReturnType<typeof getFeedProducts>>,
  brandName: string,
) {
  return buildSkroutzFeed(products, brandName);
}
