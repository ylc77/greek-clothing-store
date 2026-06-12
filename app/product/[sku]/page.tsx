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
  withLanguage
} from "@/lib/i18n";
import { getProductBySku } from "@/lib/products";
import { siteName } from "@/lib/site";

type ProductPageProps = {
  params: Promise<{
    sku: string;
  }>;
  searchParams: Promise<{
    lang?: string;
  }>;
};

type LoadedProduct = NonNullable<Awaited<ReturnType<typeof getProductBySku>>["product"]>;

function productImages(product: LoadedProduct) {
  const urls = Array.isArray(product.image_urls) ? product.image_urls.filter(Boolean) : [];
  const images = product.image_url ? [product.image_url, ...urls] : urls;
  return Array.from(new Set(images));
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function categoryBackHref(product: LoadedProduct, language: "el" | "en") {
  const params = new URLSearchParams();

  if (product.subcategory) {
    params.set("subcategory", product.subcategory);
  }

  if (language === "en") {
    params.set("lang", "en");
  }

  const query = params.toString();
  return `/${product.category}${query ? `?${query}` : ""}`;
}

export async function generateMetadata({ params, searchParams }: ProductPageProps): Promise<Metadata> {
  const [{ sku }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const language = getLanguage(resolvedSearchParams.lang);
  const { product } = await getProductBySku(decodeURIComponent(sku));

  if (!product) {
    return {
      title: siteName
    };
  }

  const title = `${productName(product, language)} | ${siteName}`;
  const description = productDescription(product, language) || productName(product, language);
  const url = `${siteUrl()}/product/${encodeURIComponent(product.sku)}`;

  return {
    title,
    description,
    alternates: {
      canonical: url
    },
    openGraph: {
      title,
      description,
      url,
      siteName,
      images: product.image_url ? [{ url: product.image_url, alt: productName(product, language) }] : []
    }
  };
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const [{ sku }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const language = getLanguage(resolvedSearchParams.lang);
  const t = text[language];
  const { product, error } = await getProductBySku(decodeURIComponent(sku));

  if (!product && !error) {
    notFound();
  }

  if (error || !product) {
    return (
      <main className="min-h-screen bg-paper">
        <SiteHeader language={language} />
        <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <Link className="text-sm font-bold text-stone-500 hover:text-ink" href={withLanguage("/", language)}>
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
  const backHref = categoryBackHref(product, language);
  const backLabel =
    product.subcategory && subcategoryLabels[product.subcategory]
      ? subcategoryLabels[product.subcategory][language]
      : categoryLabels[product.category][language];

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} />
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm font-bold text-stone-500 sm:mb-6">
          <Link className="hover:text-ink" href={withLanguage("/", language)}>
            {t.backHome}
          </Link>
          <span>/</span>
          <Link className="hover:text-ink" href={backHref}>
            {backLabel}
          </Link>
        </div>

        <div className="grid gap-5 sm:gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
          <ProductImageGallery images={images} alt={productName(product, language)} />

          <article className="rounded-md border border-stone-200 bg-white p-4 shadow-sm sm:p-7">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">{product.sku}</p>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-ink sm:text-4xl">
              {productName(product, language)}
            </h1>
            <p className="mt-5 text-3xl font-black text-terracotta">€{Number(product.price).toFixed(2)}</p>

            <div className="mt-6 grid gap-3 rounded-md bg-stone-50 p-4 text-sm text-stone-700">
              <p className="flex justify-between gap-4">
                <strong className="text-ink">{t.inStock}</strong>
                <span>{product.stock > 0 ? `${t.inStock} (${product.stock})` : t.outOfStock}</span>
              </p>
              <p className="flex justify-between gap-4">
                <strong className="text-ink">{t.category}</strong>
                <span>{categoryLabels[product.category][language]}</span>
              </p>
              {product.subcategory ? (
                <p className="flex justify-between gap-4">
                  <strong className="text-ink">{t.subcategory}</strong>
                  <span>{subcategoryLabels[product.subcategory]?.[language] || product.subcategory}</span>
                </p>
              ) : null}
            </div>

            <ProductActions
              productName={productName(product, language)}
              productNameEn={product.name_en || product.name_gr || product.sku}
              sku={product.sku}
              sizes={product.sizes}
              skroutzUrl={product.skroutz_url}
            />

            {description ? (
              <div className="mt-6 border-t border-stone-200 pt-5">
                <h2 className="text-base font-black text-ink">{t.description}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-stone-700">{description}</p>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
