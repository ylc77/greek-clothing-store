import { getSupabaseClient } from "@/lib/supabase";
import { siteUrl } from "@/lib/site";
import { categories } from "@/lib/types";

export const dynamic = "force-dynamic";

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isPublicSku(sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  return !(
    normalizedSku === "TEST" ||
    normalizedSku.startsWith("TEST-") ||
    normalizedSku.startsWith("TEST_") ||
    normalizedSku === "DEMO" ||
    normalizedSku.startsWith("DEMO-") ||
    normalizedSku.startsWith("DEMO_")
  );
}

function urlEntry(href: string, lastmod: string, changefreq: string, priority: string, alternates?: Array<{ lang: string; href: string }>) {
  const altTags = alternates
    ? alternates
        .map(
          (alt) =>
            `    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${xmlEscape(alt.href)}" />`
        )
        .join("\n")
    : "";

  return `  <url>
    <loc>${xmlEscape(href)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${altTags ? `${altTags}\n` : ""}  </url>`;
}

export async function GET() {
  const base = siteUrl();
  const today = new Date().toISOString().split("T")[0];
  const supabase = getSupabaseClient();

  const urls: string[] = [];

  // Homepage
  urls.push(
    urlEntry(base, today, "daily", "1.0", [
      { lang: "el", href: base },
      { lang: "en", href: `${base}/?lang=en` },
    ])
  );

  // Categories
  categories.forEach((cat) => {
    const catUrl = `${base}/${cat.slug}`;
    urls.push(
      urlEntry(catUrl, today, "weekly", "0.8", [
        { lang: "el", href: catUrl },
        { lang: "en", href: `${catUrl}?lang=en` },
      ])
    );
  });

  // Contact
  const contactUrl = `${base}/contact`;
  urls.push(urlEntry(contactUrl, today, "monthly", "0.5"));

  // Products
  if (supabase) {
    const { data } = await supabase
      .from("products")
      .select("sku, created_at, updated_at")
      .or("is_active.is.null,is_active.eq.true")
      .gte("stock", 0)
      .order("created_at", { ascending: false });

    if (data) {
      for (const product of data) {
        if (!isPublicSku(product.sku)) continue;
        const productUrl = `${base}/product/${encodeURIComponent(product.sku)}`;
        const lastmod = (product.updated_at || product.created_at)
          ? String(product.updated_at || product.created_at).split("T")[0]
          : today;
        urls.push(
          urlEntry(productUrl, lastmod, "weekly", "0.6", [
            { lang: "el", href: productUrl },
            { lang: "en", href: `${productUrl}?lang=en` },
          ])
        );
      }
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}
