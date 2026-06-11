import { getSupabaseClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

function xmlEscape(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function productUrl(product: Product) {
  return `${siteUrl()}/${product.category}`;
}

function buildFeed(products: Product[]) {
  const rows = products
    .map(
      (product) => `    <product>
      <id>${xmlEscape(product.sku)}</id>
      <name>${xmlEscape(product.name_gr || product.name_en)}</name>
      <description>${xmlEscape(product.description_gr || product.description_en)}</description>
      <price_with_vat>${xmlEscape(Number(product.price).toFixed(2))}</price_with_vat>
      <image>${xmlEscape(product.image_url)}</image>
      <link>${xmlEscape(productUrl(product))}</link>
      <availability>in stock</availability>
      <quantity>${xmlEscape(product.stock)}</quantity>
    </product>`
    )
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
