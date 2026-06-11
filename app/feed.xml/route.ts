import { getSupabaseClient } from "@/lib/supabase";
import type { Product, ProductCategory, ProductSubcategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const defaultBrandName = "Helios Wear";

const categoryPaths: Record<ProductCategory, string> = {
  men: "Men",
  women: "Women",
  shoes: "Shoes",
  bags: "Bags",
  luggage: "Luggage",
  hats: "Hats",
  jewelry: "Jewelry",
  other: "Other"
};

const subcategoryLabels: Partial<Record<ProductSubcategory, string>> = {
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
  accessories: "Accessories"
};

function xmlEscape(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function siteUrl() {
  const configuredUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

  if (!configuredUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredUrl)) {
    return "https://greek-clothing-store.vercel.app";
  }

  return configuredUrl.replace(/^http:\/\//i, "https://");
}

function productUrl(product: Product) {
  return `${siteUrl()}/product/${product.sku}`;
}

function productName(product: Product) {
  return product.name_gr || product.name_en || product.name_cn || product.sku;
}

function productDescription(product: Product) {
  return product.description_gr || product.description_en || product.description_cn || productName(product);
}

function productCategory(product: Product) {
  const base = categoryPaths[product.category] || product.category;
  const subcategory = product.subcategory ? subcategoryLabels[product.subcategory] || product.subcategory : "";
  return subcategory ? `${base} > ${subcategory}` : base;
}

function formatDecimal(value: number | string | null | undefined, fallback: number) {
  const numberValue = Number(value ?? fallback);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : fallback.toFixed(2);
}

function additionalImages(product: Product) {
  const imageUrls = Array.isArray(product.image_urls) ? product.image_urls : [];

  return Array.from(new Set(imageUrls.filter(Boolean))).filter(
    (imageUrl) => imageUrl !== product.image_url
  );
}

function optionalElement(name: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return `      <${name}>${xmlEscape(value)}</${name}>\n`;
}

function buildFeed(products: Product[]) {
  const rows = products
    .map((product) => {
      const imageRows = additionalImages(product)
        .slice(0, 15)
        .map((imageUrl) => `      <additional_imageurl>${xmlEscape(imageUrl)}</additional_imageurl>`)
        .join("\n");

      return `    <product>
      <id>${xmlEscape(product.sku)}</id>
      <UniqueID>${xmlEscape(product.sku)}</UniqueID>
      <name>${xmlEscape(productName(product))}</name>
      <link>${xmlEscape(productUrl(product))}</link>
      <image>${xmlEscape(product.image_url)}</image>
${imageRows ? `${imageRows}\n` : ""}      <category>${xmlEscape(productCategory(product))}</category>
      <price_with_vat>${xmlEscape(formatDecimal(product.price, 0))}</price_with_vat>
      <price>${xmlEscape(formatDecimal(product.price, 0))}</price>
      <vat>${xmlEscape(formatDecimal(product.vat, 24))}</vat>
      <availability>${product.stock > 0 ? "In stock" : "Available from 1 to 3 days"}</availability>
      <manufacturer>${xmlEscape(product.brand || defaultBrandName)}</manufacturer>
      <mpn>${xmlEscape(product.sku)}</mpn>
${optionalElement("ean", product.barcode)}${optionalElement("size", product.sizes)}      <quantity>${xmlEscape(Math.max(0, Math.trunc(Number(product.stock) || 0)))}</quantity>
      <description>${xmlEscape(productDescription(product))}</description>
${optionalElement("color", product.color).trimEnd()}
    </product>`
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
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .gt("stock", 0)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(error.message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const xml = buildFeed((data || []) as Product[]);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
