import Link from "next/link";
import { CategoryProductGrid } from "@/components/category-product-grid";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { text, withLanguage } from "@/lib/i18n";
import { getProductsByCategory } from "@/lib/products";
import type { BusinessSettings } from "@/lib/settings";
import type { ProductCategory } from "@/lib/types";
import type { Language } from "@/lib/i18n";

function categoryHref(category: ProductCategory, language: Language, subcategory?: string, page?: number) {
  const params = new URLSearchParams();

  if (language === "en") {
    params.set("lang", "en");
  }

  if (subcategory) {
    params.set("subcategory", subcategory);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return `/${category}${query ? `?${query}` : ""}`;
}

export async function CategoryPage({
  category,
  language,
  selectedSubcategory,
  page,
  title,
  subcategories,
  settings,
}: {
  category: ProductCategory;
  language: Language;
  selectedSubcategory?: string;
  page?: number;
  title: string;
  subcategories: Array<{ slug: string; label: string }>;
  settings: BusinessSettings;
}) {
  const t = text[language];
  const activeSubcategory =
    selectedSubcategory && subcategories.some((subcategory) => subcategory.slug === selectedSubcategory)
      ? selectedSubcategory
      : undefined;
  const currentPage = Math.max(1, Math.trunc(Number(page) || 1));
  const { products, error, total = 0, hasNextPage, hasPreviousPage } = await getProductsByCategory(category, activeSubcategory, currentPage);

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="mx-auto w-full max-w-[1760px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-3 rounded-3xl border border-stone-200/70 bg-white p-4 shadow-sm shadow-stone-900/5 sm:mb-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <Link
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-black text-ink transition hover:border-stone-300 hover:bg-white active:scale-[0.98] sm:min-h-11"
                href={withLanguage("/", language)}
              >
                <span aria-hidden="true">←</span>
                {t.backHome}
              </Link>
              <p className="ui-kicker mt-3 sm:mt-4">{t.categories}</p>
              <h1 className="mt-1 break-words text-2xl font-black tracking-tight text-ink sm:text-4xl">{title}</h1>
            </div>
            <p className="mb-0.5 w-fit shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-black text-stone-600 sm:px-4 sm:py-2 sm:text-sm">
              {total} {t.items}
            </p>
          </div>
        </div>

        <div className="relative mb-3 border-b border-stone-200 sm:mb-4">
          <nav className="scrollbar-none flex snap-x gap-1 overflow-x-auto pr-8 lg:flex-wrap lg:overflow-visible lg:pr-0">
            <Link
              className={`min-h-10 shrink-0 snap-start border-b-2 px-3 py-2.5 text-sm font-black transition sm:px-4 ${
                !activeSubcategory ? "border-terracotta text-ink" : "border-transparent text-stone-500 hover:border-stone-300 hover:text-ink"
              }`}
              href={categoryHref(category, language)}
            >
              {t.all}
            </Link>
            {subcategories.map((subcategory) => (
              <Link
                className={`min-h-10 shrink-0 snap-start border-b-2 px-3 py-2.5 text-sm font-black transition sm:px-4 ${
                  activeSubcategory === subcategory.slug
                    ? "border-terracotta text-ink"
                    : "border-transparent text-stone-500 hover:border-stone-300 hover:text-ink"
                }`}
                href={categoryHref(category, language, subcategory.slug)}
                key={subcategory.slug}
              >
                {subcategory.label}
              </Link>
            ))}
          </nav>
          {subcategories.length > 3 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-0 top-0 h-10 w-12 bg-gradient-to-l from-paper via-paper/90 to-transparent lg:hidden"
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
          <>
            <CategoryProductGrid products={products} language={language} />
            {hasPreviousPage || hasNextPage ? (
              <nav aria-label={language === "el" ? "Σελίδες προϊόντων" : "Product pages"} className="mt-8 flex items-center justify-center gap-3">
                {hasPreviousPage ? (
                  <Link className="min-h-11 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-ink" href={categoryHref(category, language, activeSubcategory, currentPage - 1)}>
                    {language === "el" ? "Προηγούμενη" : "Previous"}
                  </Link>
                ) : null}
                <span className="rounded-full bg-stone-100 px-4 py-3 text-sm font-bold text-stone-600">{currentPage}</span>
                {hasNextPage ? (
                  <Link className="min-h-11 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-ink" href={categoryHref(category, language, activeSubcategory, currentPage + 1)}>
                    {language === "el" ? "Επόμενη" : "Next"}
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
      <SiteFooter language={language} settings={settings} />
    </main>
  );
}
