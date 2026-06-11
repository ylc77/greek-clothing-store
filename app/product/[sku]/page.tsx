import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImageGallery } from "@/components/product-image-gallery";
import { categoryLabels, getLanguage, productName, text, withLanguage } from "@/lib/i18n";
import { getProductBySku } from "@/lib/products";

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
      <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-5xl">
          <Link className="text-sm font-bold text-stone-500" href={withLanguage("/", language)}>
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
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-bold text-stone-500">
          <Link href={withLanguage("/", language)}>{t.backHome}</Link>
          <span>/</span>
          <Link href={withLanguage(`/${product.category}`, language)}>
            {categoryLabels[product.category][language]}
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <ProductImageGallery images={images} alt={productName(product, language)} />

          <article className="rounded-md border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold uppercase tracking-wide text-olive">{product.sku}</p>
            <h1 className="mt-2 text-3xl font-bold text-ink">{productName(product, language)}</h1>
            <p className="mt-4 text-2xl font-extrabold text-terracotta">
              €{Number(product.price).toFixed(2)}
            </p>

            <div className="mt-5 grid gap-3 text-sm text-stone-700">
              <p>
                <strong className="text-ink">{t.inStock}: </strong>
                {product.stock > 0 ? `${t.inStock} (${product.stock})` : t.outOfStock}
              </p>
              <p>
                <strong className="text-ink">Category: </strong>
                {categoryLabels[product.category][language]}
              </p>
              {product.subcategory ? (
                <p>
                  <strong className="text-ink">Subcategory: </strong>
                  {product.subcategory}
                </p>
              ) : null}
              {product.sizes ? (
                <p>
                  <strong className="text-ink">Sizes: </strong>
                  {product.sizes}
                </p>
              ) : null}
            </div>

            {description ? (
              <div className="mt-6 border-t border-stone-200 pt-5">
                <h2 className="text-base font-bold text-ink">Description</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-stone-700">{description}</p>
              </div>
            ) : null}

            <Link
              className="mt-6 inline-flex rounded-md border border-stone-300 px-4 py-3 text-sm font-bold text-ink"
              href={withLanguage(`/${product.category}`, language)}
            >
              {t.backHome}
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}
