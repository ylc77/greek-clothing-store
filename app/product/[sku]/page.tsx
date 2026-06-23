import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductActions } from "@/components/product-actions";
import { ProductImageGallery } from "@/components/product-image-gallery";
import { SiteHeader } from "@/components/site-header";
import {
  categoryLabels,
  getLanguage,
  productDescription,
  productName,
  subcategoryLabels,
  text,
  withLanguage,
} from "@/lib/i18n";
import { getProductBySku } from "@/lib/products";
import { getTotalStock } from "@/lib/product-stock";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";

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
  const settings = await getBusinessSettings();
  const { product } = await getProductBySku(decodeURIComponent(sku));
  if (!product) return { title: settings.business_name };
  const title = `${productName(product, language)} | ${settings.business_name}`;
  const description =
    productDescription(product, language) || productName(product, language);
  const url = `${siteUrl()}/product/${encodeURIComponent(product.sku)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
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
  const settings = await getBusinessSettings();
  const { product, error } = await getProductBySku(decodeURIComponent(sku));

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
  // Ensure size_stock survives server→client serialization
  const ssRaw = (product as Record<string, unknown>).size_stock;
  const safeSizeStock: Record<string, number> | null =
    ssRaw && typeof ssRaw === "object" && !Array.isArray(ssRaw)
      ? JSON.parse(JSON.stringify(ssRaw))
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

  const ean = product.ean?.trim() || product.barcode?.trim() || "";

  const detailItems = [
    { label: t.stock, value: stockQty > 0 ? `${t.inStockLabel} (${stockQty})` : t.outOfStockLabel },
    { label: t.category, value: categoryLabels[product.category][language] },
    product.subcategory
      ? { label: t.subcategory, value: subcategoryLabels[product.subcategory]?.[language] || product.subcategory }
      : null,
    isReal(product.brand) ? { label: t.brand, value: product.brand!.trim() } : null,
    isReal(ean) ? { label: t.ean, value: ean } : null,
    isReal(product.material) ? { label: t.material, value: product.material!.trim() } : null,
    isReal(product.fit) ? { label: t.fit, value: product.fit!.trim() } : null,
    isReal(product.season) ? { label: t.season, value: product.season!.trim() } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* Breadcrumb */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold text-stone-400 sm:text-sm">
          <Link className="hover:text-ink" href={withLanguage("/", language)}>
            {t.backHome}
          </Link>
          <span>/</span>
          <Link className="hover:text-ink" href={backHref}>
            {backLabel}
          </Link>
          <span>/</span>
          <span className="text-ink">{productName(product, language)}</span>
        </div>

        {/* Main layout */}
        <div className="grid gap-6 lg:grid-cols-[54fr_46fr] lg:gap-10">
          {/* Left: image gallery */}
          <div>
            <ProductImageGallery
              images={images}
              alt={productName(product, language)}
              language={language}
            />
          </div>

          {/* Right: info */}
          <div className="flex flex-col">
            {/* SKU */}
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-olive">
              {product.sku}
            </p>

            {/* Name */}
            <h1 className="mt-3 text-2xl font-black leading-tight tracking-tight text-ink sm:text-3xl lg:text-4xl">
              {productName(product, language)}
            </h1>

            {/* Price */}
            <p className="mt-4 text-2xl font-black text-terracotta sm:text-3xl">
              €{Number(product.price).toFixed(2)}
            </p>

            {/* Description (short) */}
            {description ? (
              <p className="mt-4 text-sm leading-relaxed text-stone-500 sm:text-base">
                {description}
              </p>
            ) : null}

            {/* Size selector + buttons */}
            <div className="mt-6">
              <ProductActions
                productName={productName(product, language)}
                productNameEn={product.name_en || product.name_cn || product.sku}
                sku={product.sku}
                sizes={product.sizes}
                sizeStock={safeSizeStock}
                stock={Number(product.stock)}
                skroutzUrl={product.skroutz_url}
                language={language}
                whatsappUrl={settings.whatsapp || undefined}
              />
            </div>

            {/* Purchase note */}
            <p className="mt-4 text-xs leading-relaxed text-stone-400">
              {t.purchaseNote}
            </p>

            {/* Details (collapsible or always shown) */}
            {detailItems.length > 0 ? (
              <div className="mt-6 border-t border-stone-100 pt-5">
                <h3 className="text-sm font-black text-ink">{t.details}</h3>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  {detailItems.map((d) => (
                    <p key={d.label} className="flex justify-between gap-2 text-xs sm:text-sm">
                      <span className="text-stone-400">{d.label}</span>
                      <span className="font-bold text-stone-700 text-right">{d.value}</span>
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
          __html: JSON.stringify({
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
              url: `${siteUrl()}/product/${encodeURIComponent(product.sku)}`,
            },
            brand: product.brand ? { "@type": "Brand", name: product.brand.trim() } : undefined,
          }),
        }}
      />
    </main>
  );
}
