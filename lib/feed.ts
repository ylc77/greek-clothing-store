/**
 * Skroutz / MyWebstore Feed generator — reusable utilities.
 *
 * Usage:
 *   const products = await getFeedProducts();
 *   const xml = buildSkroutzFeed(products, brandName);
 *
 * To add a new feed format (Google, Meta, BestPrice), add a new
 * buildXxxFeed() function here and create a new route.ts.
 */

import { getSupabaseClient } from "@/lib/supabase";
import { getTotalStock } from "@/lib/product-stock";
import type { Product, ProductCategory, ProductSubcategory } from "@/lib/types";
import { siteUrl } from "@/lib/site";

/* ── Category paths (English, used in Skroutz feed) ─────────── */
export const categoryPathEn: Record<ProductCategory, string> = {
  men: "Men", women: "Women", shoes: "Shoes", bags: "Bags",
  luggage: "Luggage", hats: "Hats", jewelry: "Jewelry", other: "Other",
};

export const subcategoryPathEn: Partial<Record<ProductSubcategory, string>> = {
  tshirts: "T-Shirts", shirts: "Shirts", hoodies: "Hoodies", jackets: "Jackets",
  trousers: "Trousers", jeans: "Jeans", shorts: "Shorts", dresses: "Dresses",
  tops: "Tops", skirts: "Skirts", sneakers: "Sneakers", boots: "Boots",
  sandals: "Sandals", heels: "Heels", handbags: "Handbags", backpacks: "Backpacks",
  wallets: "Wallets", suitcases: "Suitcases", travel_bags: "Travel Bags",
  caps: "Caps", beanies: "Beanies", necklaces: "Necklaces", bracelets: "Bracelets",
  earrings: "Earrings", rings: "Rings", accessories: "Accessories",
};

/* ── XML helpers ────────────────────────────────────────────── */
export function xmlEscape(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function opt(tag: string, value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "";
  return `      <${tag}>${xmlEscape(value)}</${tag}>\n`;
}

export function formatPrice(value: number | string | null | undefined, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n.toFixed(2) : fallback.toFixed(2);
}

/* ── Product helpers ───────────────────────────────────────── */
export function productUrl(product: Product) {
  return `${siteUrl()}/product/${encodeURIComponent(product.sku)}`;
}

export function feedName(product: Product) {
  return product.name_en || product.name_gr || product.name_cn || product.sku;
}

export function feedDescription(product: Product) {
  return product.description_en || product.description_gr || product.description_cn || feedName(product);
}

export function feedCategory(product: Product) {
  if (product.category_path_en?.trim()) return product.category_path_en.trim();
  const base = categoryPathEn[product.category] || product.category;
  const sub = product.subcategory ? subcategoryPathEn[product.subcategory] || product.subcategory : "";
  return sub ? `${base} > ${sub}` : base;
}

/** All additional image URLs, deduplicated, excluding main image */
export function getProductImages(product: Product): string[] {
  const fromUrls: string[] = Array.isArray(product.image_urls)
    ? product.image_urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : [];
  const fromExtra = (product.additional_image_urls || "")
    .split(/[\r?\n,]+/)
    .map(u => u.trim())
    .filter(Boolean);
  return Array.from(new Set([...fromUrls, ...fromExtra])).filter(u => u !== product.image_url);
}

/* ── Data fetching ─────────────────────────────────────────── */
export async function getFeedProducts(): Promise<Product[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .gte("stock", 0)
    .order("created_at", { ascending: false });
  return (data || []) as Product[];
}

/* ── Feed builder: Skroutz / MyWebstore ───────────────────── */
export function buildSkroutzFeed(products: Product[], brandName: string): string {
  const rows = products.map(product => {
    const stockQty = getTotalStock(product);
    const image = product.image_url?.trim() || "";
    const imageTag = image ? `      <image>${xmlEscape(image)}</image>\n` : "";
    const extras = getProductImages(product).slice(0, 15)
      .map(u => `      <additional_imageurl>${xmlEscape(u)}</additional_imageurl>`)
      .join("\n");
    const mpn = product.mpn?.trim() || product.sku;
    const ean = product.ean?.trim() || product.barcode?.trim() || "";
    const availability = product.availability?.trim() || (stockQty > 0 ? "In stock" : "Available from 1 to 3 days");

    return `    <product>
      <id>${xmlEscape(product.sku)}</id>
      <uid>${xmlEscape(product.sku)}</uid>
      <name>${xmlEscape(feedName(product))}</name>
      <link>${xmlEscape(productUrl(product))}</link>
${imageTag}      <category>${xmlEscape(feedCategory(product))}</category>
      <price_with_vat>${xmlEscape(formatPrice(product.price))}</price_with_vat>
      <price>${xmlEscape(formatPrice(product.price))}</price>
      <vat>${xmlEscape(formatPrice(product.vat, 24))}</vat>
      <instock>${stockQty > 0 ? "Y" : "N"}</instock>
      <availability>${xmlEscape(availability)}</availability>
      <manufacturer>${xmlEscape(product.brand || brandName)}</manufacturer>
      <mpn>${xmlEscape(mpn)}</mpn>
${opt("ean", ean)}${opt("size", product.sizes)}${opt("color", product.color)}      <quantity>${Math.max(0, Math.trunc(stockQty))}</quantity>
      <description>${xmlEscape(feedDescription(product))}</description>
${extras ? `${extras}\n` : ""}    </product>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<mywebstore>
  <created_at>${new Date().toISOString()}</created_at>
  <products>
${rows}
  </products>
</mywebstore>`;
}
