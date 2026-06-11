import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImageGallery } from "@/components/product-image-gallery";
import { SiteHeader } from "@/components/site-header";
import { categoryLabels, getLanguage, productName, text, withLanguage } from "@/lib/i18n";
import { getProductBySku } from "@/lib/products";
import { whatsappUrl } from "@/lib/site";

type ProductPageProps = {
  params: Promise<{
    sku: string;
  }>;
  searchParams: Promise<{
    lang?: string;
  }>;
};

function productDescription(
  product: NonNullable<Awaited<ReturnType<typeof getProductBySku>>["product"]>,
  language: "el" | "en"
) {
  return language === "en"
    ? product.description_en || product.description_gr || ""
    : product.description_gr || product.description_en || "";
}

function productImages(product: NonNullable<Awaited<ReturnType<typeof getProductBySku>>["product"]>) {
  const urls = Array.isArray(product.image_urls) ? product.image_urls.filter(Boolean) : [];
  const images = product.image_url ? [product.image_url, ...urls] : urls;
  return Array.from(new Set(images));
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

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} />
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-bold text-stone-500">
          <Link className="hover:text-ink" href={withLanguage("/", language)}>
            {t.backHome}
          </Link>
          <span>/</span>
          <Link className="hover:text-ink" href={withLanguage(`/${product.category}`, language)}>
            {categoryLabels[product.category][language]}
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
          <ProductImageGallery images={images} alt={productName(product, language)} />

          <article className="rounded-md border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">{product.sku}</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">
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
                  <span>{product.subcategory}</span>
                </p>
              ) : null}
              {product.sizes ? (
                <p className="flex justify-between gap-4">
                  <strong className="text-ink">{t.sizes}</strong>
                  <span>{product.sizes}</span>
                </p>
              ) : null}
            </div>

            <a
              className="mt-6 inline-flex w-full justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-stone-800"
              href={`${whatsappUrl}?text=${encodeURIComponent(`${product.sku} - ${productName(product, language)}`)}`}
              rel="noreferrer"
              target="_blank"
            >
              {t.whatsapp}
            </a>

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
