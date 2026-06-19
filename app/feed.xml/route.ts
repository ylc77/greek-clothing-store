import { getSupabaseClient } from "@/lib/supabase";
import { getBusinessSettings } from "@/lib/settings";
import type { Product, ProductCategory, ProductSubcategory } from "@/lib/types";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const categoryPathEn: Record<ProductCategory, string> = {
  men: "Men",
  women: "Women",
  shoes: "Shoes",
  bags: "Bags",
  luggage: "Luggage",
  hats: "Hats",
  jewelry: "Jewelry",
  other: "Other",
};

const subcategoryPathEn: Partial<Record<ProductSubcategory, string>> = {
  tshirts: "T-Shirts",
  shirts: "Shirts",
  hoodies: "Hoodies",
  jackets: "Jackets",
  trousers: "Trousers",
  jeans: "Jeans",
  shorts: "Shorts",
  dresses: "Dresses",
  tops: "Tops",
  skirts: "Skirts",
  sneakers: "Sneakers",
  boots: "Boots",
  sandals: "Sandals",
  heels: "Heels",
  handbags: "Handbags",
  backpacks: "Backpacks",
  wallets: "Wallets",
  suitcases: "Suitcases",
  travel_bags: "Travel Bags",
  caps: "Caps",
  beanies: "Beanies",
  necklaces: "Necklaces",
  bracelets: "Bracelets",
  earrings: "Earrings",
  rings: "Rings",
  accessories: "Accessories",
};

function xmlEscape(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function productUrl(product: Product) {
  return `${siteUrl()}/product/${encodeURIComponent(product.sku)}`;
}

/** Prefer English, fall back through Greek → Chinese → SKU */
function feedName(product: Product) {
  return product.name_en || product.name_gr || product.name_cn || product.sku;
}

/** Prefer English, fall back through Greek → Chinese → name */
function feedDescription(product: Product) {
  return (
    product.description_en ||
    product.description_gr ||
    product.description_cn ||
    feedName(product)
  );
}

/** Use category_path_en if set, otherwise build from labels */
function feedCategory(product: Product) {
  if (product.category_path_en?.trim()) return product.category_path_en.trim();
  const base = categoryPathEn[product.category] || product.category;
  const sub = product.subcategory
    ? subcategoryPathEn[product.subcategory] || product.subcategory
    : "";
  return sub ? `${base} > ${sub}` : base;
}

function formatPrice(value: number | string | null | undefined, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n.toFixed(2) : fallback.toFixed(2);
}

function opt(name: string, value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "";
  return `      <${name}>${xmlEscape(value)}</${name}>\n`;
}

function allAdditionalUrls(product: Product): string[] {
  const fromImageUrls: string[] = Array.isArray(product.image_urls)
    ? product.image_urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : [];

  const fromExtra = (product.additional_image_urls || "")
    .split(/[\r?\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const all = [...fromImageUrls, ...fromExtra];
  return Array.from(new Set(all)).filter((u) => u !== product.image_url);
}

function buildFeed(products: Product[], defaultBrandName: string) {
  const rows = products
    .map((product) => {
      const image = product.image_url?.trim() || "";
      const imageTag = image ? `      <image>${xmlEscape(image)}</image>\n` : "";

      const extras = allAdditionalUrls(product)
        .slice(0, 15)
        .map((u) => `      <additional_imageurl>${xmlEscape(u)}</additional_imageurl>`)
        .join("\n");

      const mpn = product.mpn?.trim() || product.sku;
      const ean = product.ean?.trim() || product.barcode?.trim() || "";
      const availability =
        product.availability?.trim() ||
        (product.stock > 0 ? "In stock" : "Available from 1 to 3 days");

      return `    <product>
      <id>${xmlEscape(product.sku)}</id>
      <uid>${xmlEscape(product.sku)}</uid>
      <name>${xmlEscape(feedName(product))}</name>
      <link>${xmlEscape(productUrl(product))}</link>
${imageTag}      <category>${xmlEscape(feedCategory(product))}</category>
      <price_with_vat>${xmlEscape(formatPrice(product.price))}</price_with_vat>
      <price>${xmlEscape(formatPrice(product.price))}</price>
      <vat>${xmlEscape(formatPrice(product.vat, 24))}</vat>
      <instock>${product.stock > 0 ? "Y" : "N"}</instock>
      <availability>${xmlEscape(availability)}</availability>
      <manufacturer>${xmlEscape(product.brand || defaultBrandName)}</manufacturer>
      <mpn>${xmlEscape(mpn)}</mpn>
${opt("ean", ean)}${opt("size", product.sizes)}${opt("color", product.color)}      <quantity>${Math.max(0, Math.trunc(Number(product.stock) || 0))}</quantity>
      <description>${xmlEscape(feedDescription(product))}</description>
${extras ? `${extras}\n` : ""}    </product>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<mywebstore>
  <created_at>${new Date().toISOString()}</created_at>
  <products>
${rows}
  </products>
</mywebstore>`;
}

export async function GET() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return new Response(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  const settings = await getBusinessSettings();
  const defaultBrandName = settings.business_name || "Our Store";

  // Only active products with stock >= 0
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .gte("stock", 0)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(error.message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const xml = buildFeed((data || []) as Product[], defaultBrandName);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}
