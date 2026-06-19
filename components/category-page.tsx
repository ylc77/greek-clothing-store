import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { SiteHeader } from "@/components/site-header";
import { subcategoryLabels, text, withLanguage } from "@/lib/i18n";
import { getProductsByCategory } from "@/lib/products";
import type { BusinessSettings } from "@/lib/settings";
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
  title,
  settings,
}: {
  category: ProductCategory;
  language: Language;
  selectedSubcategory?: string;
  title: string;
  settings?: BusinessSettings;
}) {
  const t = text[language];
  const activeSubcategory =
    selectedSubcategory && isProductSubcategory(category, selectedSubcategory)
      ? selectedSubcategory
      : undefined;
  const { products, error } = await getProductsByCategory(category, activeSubcategory);

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-stone-200 pb-5 sm:mb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
          <div>
            <Link className="text-sm font-black text-stone-500 hover:text-ink" href={withLanguage("/", language)}>
              {t.backHome}
            </Link>
            <p className="mt-4 text-sm font-black uppercase tracking-[0.18em] text-olive">{t.categories}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">{title}</h1>
          </div>
          <p className="text-sm font-bold text-stone-500">
            {products.length} {t.items}
          </p>
        </div>

        <nav className="mb-6 flex gap-2 overflow-x-auto pb-2 sm:mb-7">
          <Link
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-black transition ${
              !activeSubcategory ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink"
            }`}
            href={categoryHref(category, language)}
          >
            {t.all}
          </Link>
          {subcategoriesByCategory[category].map((subcategory) => (
            <Link
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-black transition ${
                activeSubcategory === subcategory
                  ? "border-ink bg-ink text-white"
                  : "border-stone-200 bg-white text-ink"
              }`}
              href={categoryHref(category, language, subcategory)}
              key={subcategory}
            >
              {subcategoryLabels[subcategory][language]}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.sku} product={product} language={language} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
