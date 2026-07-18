import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductActions } from "@/components/product-actions";
import { ProductImageGallery } from "@/components/product-image-gallery";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  categoryLabels,
  getLanguage,
  getLocalizedMaterial,
  productDescription,
  productName,
  subcategoryLabels,
  text,
  withLanguage,
} from "@/lib/i18n";
import { getProductBySku } from "@/lib/products";
import { getTotalStock } from "@/lib/product-stock";
import { getFeatureSettings } from "@/lib/features";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { serializeJsonForHtmlScript } from "@/lib/serialize-json-for-html-script";
import { buildLanguageAlternates } from "@/lib/storefront-seo";

type ProductPageProps = {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ lang?: string }>;
};

type LoadedProduct = NonNullable<
  Awaited<ReturnType<typeof getProductBySku>>["product"]
>;

function productImages(product: LoadedProduct) {
  const urls = Array.isArray(product.image_urls)
    ? product.image_urls.filter(Boolean)
    : [];
  const images = product.image_url ? [product.image_url, ...urls] : urls;
  return Array.from(new Set(images));
}

function categoryBackHref(product: LoadedProduct, language: "el" | "en") {
  const params = new URLSearchParams();
  if (product.subcategory) params.set("subcategory", product.subcategory);
  if (language === "en") params.set("lang", "en");
  const query = params.toString();
  return `/${product.category}${query ? `?${query}` : ""}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: ProductPageProps): Promise<Metadata> {
  const [{ sku }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const language = getLanguage(resolvedSearchParams.lang);
  const [settings, productResult] = await Promise.all([
    getBusinessSettings(),
    getProductBySku(decodeURIComponent(sku)),
  ]);
  const { product } = productResult;
  if (!product) return { title: settings.business_name };
  const title = `${productName(product, language)} | ${settings.business_name}`;
  const description =
    productDescription(product, language) || productName(product, language);
  const alternates = buildLanguageAlternates(
    `/product/${encodeURIComponent(product.sku)}`,
    language,
    {},
    siteUrl(),
  );
  const url = alternates.canonical;
  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url,
      siteName: settings.business_name,
      images: product.image_url
        ? [{ url: product.image_url, alt: productName(product, language) }]
        : [],
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  const [{ sku }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const language = getLanguage(resolvedSearchParams.lang);
  const t = text[language];
  const [settings, productResult, featureSettings] = await Promise.all([
    getBusinessSettings(),
    getProductBySku(decodeURIComponent(sku)),
    getFeatureSettings(),
  ]);
  const { product, error } = productResult;

  if (!product && !error) notFound();

  if (error || !product) {
    return (
      <main className="min-h-screen bg-paper">
        <SiteHeader language={language} settings={settings} />
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <Link
            className="text-sm font-bold text-stone-500 hover:text-ink"
            href={withLanguage("/", language)}
          >
            {t.backHome}
          </Link>
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <strong>{t.cannotLoad}</strong>
            <p className="mt-2">{error}</p>
          </div>
        </section>
      </main>
    );
  }

  const images = productImages(product);
  const description = productDescription(product, language);
  const stockQty = getTotalStock(product);
  // Ensure size_stock survives server鈫抍lient serialization
  const ssRaw = (product as Record<string, unknown>).size_stock;
  const safeSizeStock: Record<string, number> | null =
    ssRaw && typeof ssRaw === "object" && !Array.isArray(ssRaw)
      ? JSON.parse(JSON.stringify(ssRaw))
      : null;
  const sizeChartRaw = product.size_chart;
  const safeSizeChart: Record<string, unknown> | null =
    sizeChartRaw && typeof sizeChartRaw === "object" && !Array.isArray(sizeChartRaw)
      ? JSON.parse(JSON.stringify(sizeChartRaw))
      : null;
  const backHref = categoryBackHref(product, language);
  const backLabel =
    product.subcategory && subcategoryLabels[product.subcategory]
      ? subcategoryLabels[product.subcategory][language]
      : categoryLabels[product.category][language];

  // Filter out placeholder / meaningless values
  function isReal(v: string | null | undefined): v is string {
    if (!v || !v.trim()) return false;
    const s = v.trim().toUpperCase();
    return s !== "NO" && s !== "N/A" && s !== "-" && s !== "NONE" && s !== "NA";
  }

  // Internal Code 128 barcodes are useful for POS/labels but are not necessarily GTIN/EAN.
  const ean = product.ean?.trim() || "";
  const localizedValue = (greek?: string | null, english?: string | null) =>
    language === "en" ? english?.trim() || greek?.trim() : greek?.trim() || english?.trim();
  const verifiedMaterial = getLocalizedMaterial(
    product.material,
    language,
    (product as Record<string, unknown>).material_verified as boolean,
  );

  const detailItems = [
    { label: t.stock, value: stockQty > 0 ? `${t.inStockLabel} (${stockQty})` : t.outOfStockLabel },
    { label: t.category, value: categoryLabels[product.category][language] },
    product.subcategory
      ? { label: t.subcategory, value: subcategoryLabels[product.subcategory]?.[language] || product.subcategory }
      : null,
    isReal(product.brand) ? { label: t.brand, value: product.brand!.trim() } : null,
    isReal(ean) ? { label: t.ean, value: ean } : null,
    isReal(verifiedMaterial) ? { label: t.material, value: verifiedMaterial } : null,
    isReal(localizedValue(product.fiber_composition_gr, product.fiber_composition_en))
      ? { label: language === "en" ? "Fiber composition" : "Σύνθεση ινών", value: localizedValue(product.fiber_composition_gr, product.fiber_composition_en)! }
      : null,
    isReal(localizedValue(product.care_instructions_gr, product.care_instructions_en))
      ? { label: language === "en" ? "Care instructions" : "Οδηγίες φροντίδας", value: localizedValue(product.care_instructions_gr, product.care_instructions_en)! }
      : null,
    isReal(product.country_of_origin)
      ? { label: language === "en" ? "Country of origin" : "Χώρα προέλευσης", value: product.country_of_origin!.trim() }
      : null,
    isReal(product.manufacturer_name)
      ? { label: language === "en" ? "Manufacturer" : "Κατασκευαστής", value: product.manufacturer_name!.trim() }
      : null,
    isReal(product.manufacturer_contact)
      ? { label: language === "en" ? "Manufacturer contact" : "Επικοινωνία κατασκευαστή", value: product.manufacturer_contact!.trim() }
      : null,
    isReal(product.eu_responsible_person)
      ? { label: language === "en" ? "EU responsible person" : "Υπεύθυνο πρόσωπο ΕΕ", value: product.eu_responsible_person!.trim() }
      : null,
    isReal(localizedValue(product.product_safety_notes_gr, product.product_safety_notes_en))
      ? { label: language === "en" ? "Safety information" : "Πληροφορίες ασφάλειας", value: localizedValue(product.product_safety_notes_gr, product.product_safety_notes_en)! }
      : null,
    isReal(product.fit) ? { label: t.fit, value: product.fit!.trim() } : null,
    isReal(product.season) ? { label: t.season, value: product.season!.trim() } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="ui-container py-4 sm:py-6">
        {/* Breadcrumb */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold text-stone-500 sm:mb-5 sm:text-sm">
          <Link
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-2 text-ink shadow-sm transition hover:border-stone-300 hover:bg-stone-50 hover:shadow active:scale-[0.98]"
            href={withLanguage("/", language)}
          >
            <span aria-hidden="true">←</span>
            {t.backHome}
          </Link>
          <span className="text-stone-300">/</span>
          <Link
            className="inline-flex min-h-10 items-center rounded-full border border-stone-200 bg-white px-3 py-2 text-ink shadow-sm transition hover:border-stone-300 hover:bg-stone-50 hover:shadow active:scale-[0.98]"
            href={backHref}
          >
            {backLabel}
          </Link>
          <span className="text-stone-300">/</span>
          <span className="min-h-10 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100 px-3 py-2 text-ink">
            <span className="line-clamp-1">{productName(product, language)}</span>
          </span>
        </div>

        {/* Main layout */}
        <div className="grid min-w-0 gap-6 lg:grid-cols-[58fr_42fr] lg:gap-12">
          {/* Left: image gallery */}
          <div className="min-w-0">
            <ProductImageGallery
              images={images}
              alt={productName(product, language)}
              language={language}
            />
          </div>

          {/* Right: info */}
          <div className="flex min-w-0 flex-col rounded-3xl border border-stone-200/70 bg-white p-4 shadow-sm shadow-stone-900/5 sm:p-7 lg:sticky lg:top-28 lg:self-start">
            {/* SKU */}
            <p className="break-all text-xs font-bold uppercase tracking-[0.15em] text-olive">
              {product.sku}
            </p>

            {/* Name */}
            <h1 className="mt-3 [overflow-wrap:anywhere] text-2xl font-black leading-tight tracking-tight text-ink sm:text-3xl lg:text-4xl">
              {productName(product, language)}
            </h1>

            {/* Price */}
            <p className="mt-4 text-3xl font-black leading-none text-terracotta sm:text-3xl">
              €{Number(product.price).toFixed(2)}
            </p>

            {/* Description (short) */}
            {description ? (
              <p className="mt-4 [overflow-wrap:anywhere] text-sm leading-relaxed text-stone-500 sm:text-base">
                {description}
              </p>
            ) : null}

            {/* Size selector + buttons */}
            <div className="mt-6">
              <ProductActions
                productName={productName(product, language)}
                productNameEn={product.name_en || product.name_gr || product.sku}
                productNameGr={product.name_gr || product.name_en || product.sku}
                sku={product.sku}
                sizes={product.sizes}
                sizeSystem={product.size_system}
                sizeStock={safeSizeStock}
                stock={Number(product.stock)}
                skroutzUrl={product.skroutz_url}
                skroutzEnabled={featureSettings.features.skroutz_feed && settings.enable_skroutz}
                aiEnabled={featureSettings.features.ai_tools}
                language={language}
                category={product.category}
                subcategory={product.subcategory || undefined}
                price={Number(product.price)}
                imageUrl={product.image_url || undefined}
                sizeChart={safeSizeChart}
                fitType={product.fit_type || "regular"}
                whatsappUrl={settings.whatsapp || undefined}
              />
            </div>

            {/* Purchase note */}
            <p className="mt-4 text-xs leading-relaxed text-stone-600">
              {featureSettings.features.skroutz_feed && settings.enable_skroutz ? t.purchaseNote : t.purchaseContactNote}
            </p>

            {/* Details (collapsible or always shown) */}
            {detailItems.length > 0 ? (
              <div className="mt-6 rounded-2xl border border-stone-200/70 bg-stone-50/70 p-4">
                <h3 className="text-sm font-black text-ink">{t.details}</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:gap-x-4">
                  {detailItems.map((d) => (
                    <p key={d.label} className="flex items-start justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 text-xs sm:bg-transparent sm:px-0 sm:py-0 sm:text-sm">
                      <span className="shrink-0 text-stone-600">{d.label}</span>
                      <span className="min-w-0 [overflow-wrap:anywhere] text-right font-bold text-stone-700">{d.value}</span>
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Product JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonForHtmlScript({
            "@context": "https://schema.org",
            "@type": "Product",
            name: productName(product, language),
            description: productDescription(product, language) || productName(product, language),
            sku: product.sku,
            image: product.image_url || undefined,
            offers: {
              "@type": "Offer",
              price: Number(product.price).toFixed(2),
              priceCurrency: "EUR",
              availability: stockQty > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
              url: buildLanguageAlternates(
                `/product/${encodeURIComponent(product.sku)}`,
                language,
                {},
                siteUrl(),
              ).canonical,
            },
            brand: product.brand ? { "@type": "Brand", name: product.brand.trim() } : undefined,
          }),
        }}
      />
      <SiteFooter language={language} settings={settings} />
    </main>
  );
}
