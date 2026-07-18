import { getSupabaseClient } from "@/lib/supabase";
import { siteUrl } from "@/lib/site";
import { categories } from "@/lib/types";
import { SITEMAP_PRODUCT_SELECT } from "@/lib/product-data-boundary";
import { buildLanguageAlternates } from "@/lib/storefront-seo";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";

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

  function languageLinks(pathname: string) {
    const alternates = buildLanguageAlternates(pathname, "el", {}, base);
    return Object.entries(alternates.languages).map(([lang, href]) => ({ lang, href }));
  }

  // Homepage
  urls.push(
    urlEntry(base, today, "daily", "1.0", languageLinks("/"))
  );

  // Categories
  categories.forEach((cat) => {
    const catUrl = `${base}/${cat.slug}`;
    urls.push(
      urlEntry(catUrl, today, "weekly", "0.8", languageLinks(`/${cat.slug}`))
    );
  });

  // Contact
  const contactUrl = `${base}/contact`;
  urls.push(urlEntry(contactUrl, today, "monthly", "0.5", languageLinks("/contact")));

  // Legal pages
  ["/privacy-policy", "/terms-of-service", "/cookie-policy", "/refund-policy", "/return-policy", "/shipping-policy"].forEach((path) => {
    const url = `${base}${path}`;
    urls.push(
      urlEntry(url, today, "yearly", "0.3", languageLinks(path))
    );
  });

  // Products
  if (supabase) {
    const result = await fetchAllSupabaseRows<{
        sku: string;
        created_at: string | null;
        updated_at: string | null;
      }>(async (from, to) => {
        const page = await supabase
          .from("products")
          .select(SITEMAP_PRODUCT_SELECT)
          .or("is_active.is.null,is_active.eq.true")
          .order("id", { ascending: true })
          .range(from, to);
        return page as unknown as { data: Array<{ sku: string; created_at: string | null; updated_at: string | null }> | null; error: { message?: string } | null };
      });
    if (result.error) {
      return new Response("Sitemap product query is temporarily unavailable.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (result.data) {
      const products = result.data;
      for (const product of products) {
        if (!isPublicSku(product.sku)) continue;
        const productUrl = `${base}/product/${encodeURIComponent(product.sku)}`;
        const lastmod = (product.updated_at || product.created_at)
          ? String(product.updated_at || product.created_at).split("T")[0]
          : today;
        urls.push(
          urlEntry(
            productUrl,
            lastmod,
            "weekly",
            "0.6",
            languageLinks(`/product/${encodeURIComponent(product.sku)}`),
          )
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
