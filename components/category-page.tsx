import Link from "next/link";
import { productName, text, withLanguage } from "@/lib/i18n";
import { getProductsByCategory } from "@/lib/products";
import { isProductSubcategory, subcategoriesByCategory, type ProductCategory } from "@/lib/types";
import type { Language } from "@/lib/i18n";

function categoryHref(category: ProductCategory, language: Language, subcategory?: string) {
  const params = new URLSearchParams();

  if (language === "en") {
    params.set("lang", "en");
  }

  if (subcategory) {
    params.set("subcategory", subcategory);
  }

  const query = params.toString();
  return `/${category}${query ? `?${query}` : ""}`;
}

export async function CategoryPage({
  category,
  language,
  selectedSubcategory,
  title
}: {
  category: ProductCategory;
  language: Language;
  selectedSubcategory?: string;
  title: string;
}) {
  const t = text[language];
  const activeSubcategory =
    selectedSubcategory && isProductSubcategory(category, selectedSubcategory)
      ? selectedSubcategory
      : undefined;
  const { products, error } = await getProductsByCategory(category, activeSubcategory);

  return (
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Link className="text-sm font-bold text-stone-500" href={withLanguage("/", language)}>
              {t.backHome}
            </Link>
            <h1 className="mt-2 text-4xl font-bold text-ink">{title}</h1>
          </div>
        </div>

        <nav className="mb-6 flex flex-wrap gap-2">
          <Link
            className={`rounded-md border px-3 py-2 text-sm font-bold ${
              !activeSubcategory ? "border-ink bg-ink text-white" : "border-stone-300 bg-white text-ink"
            }`}
            href={categoryHref(category, language)}
          >
            All
          </Link>
          {subcategoriesByCategory[category].map((subcategory) => (
            <Link
              className={`rounded-md border px-3 py-2 text-sm font-bold ${
                activeSubcategory === subcategory
                  ? "border-ink bg-ink text-white"
                  : "border-stone-300 bg-white text-ink"
              }`}
              href={categoryHref(category, language, subcategory)}
              key={subcategory}
            >
              {subcategory}
            </Link>
          ))}
        </nav>

        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <strong>{t.cannotLoad}</strong>
            <p className="mt-2">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-stone-600">
            {t.noCategoryProducts}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <article className="overflow-hidden rounded-md border border-stone-200 bg-white" key={product.sku}>
                <img
                  alt={productName(product, language)}
                  className="aspect-[4/5] w-full object-cover"
                  src={product.image_url}
                />
                <div className="p-3">
                  <h2 className="line-clamp-2 min-h-10 text-sm font-bold text-ink">{productName(product, language)}</h2>
                  <p className="mt-2 text-base font-extrabold text-terracotta">
                    €{Number(product.price).toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-stone-500">
                    {product.stock > 0 ? t.inStock : t.outOfStock}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
