import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { SiteHeader } from "@/components/site-header";
import { subcategoryLabels, text, withLanguage } from "@/lib/i18n";
import { getProductsByCategory } from "@/lib/products";
import type { BusinessSettings } from "@/lib/settings";
import { isProductSubcategory, subcategoryList, type ProductCategory } from "@/lib/types";
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
  const subcategories = Array.from(
    new Set([
      ...(subcategoryList[category] || []),
      ...products
        .map((product) => product.subcategory?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ]),
  );

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="ui-container py-6 sm:py-8">
        <div className="mb-6 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm shadow-stone-900/5 sm:mb-7 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Link
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-black text-ink shadow-sm transition hover:border-stone-300 hover:bg-white hover:shadow active:scale-[0.98]"
                href={withLanguage("/", language)}
              >
                <span aria-hidden="true">←</span>
                {t.backHome}
              </Link>
              <p className="ui-kicker mt-5">{t.categories}</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">{title}</h1>
            </div>
            <p className="w-fit rounded-full bg-stone-100 px-4 py-2 text-sm font-black text-stone-600">
              {products.length} {t.items}
            </p>
          </div>
        </div>

        <div className="relative mb-6 sm:mb-7">
          <nav className="scrollbar-none flex snap-x gap-2 overflow-x-auto pb-2 pr-8">
            <Link
              className={`min-h-11 shrink-0 snap-start rounded-full border px-4 py-2.5 text-sm font-black shadow-sm transition ${
                !activeSubcategory ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink hover:border-stone-300"
              }`}
              href={categoryHref(category, language)}
            >
              {t.all}
            </Link>
            {subcategories.map((subcategory) => (
              <Link
                className={`min-h-11 shrink-0 snap-start rounded-full border px-4 py-2.5 text-sm font-black shadow-sm transition ${
                  activeSubcategory === subcategory
                    ? "border-ink bg-ink text-white"
                    : "border-stone-200 bg-white text-ink hover:border-stone-300"
                }`}
                href={categoryHref(category, language, subcategory)}
                key={subcategory}
              >
                {subcategoryLabels[subcategory]?.[language] || subcategory}
              </Link>
            ))}
          </nav>
          {subcategories.length > 3 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-0 top-0 h-12 w-12 bg-gradient-to-l from-paper via-paper/85 to-transparent"
            />
          ) : null}
        </div>

        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <strong>{t.cannotLoad}</strong>
            <p className="mt-2">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center font-bold text-stone-500">
            {t.noCategoryProducts}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.sku} product={product} language={language} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
