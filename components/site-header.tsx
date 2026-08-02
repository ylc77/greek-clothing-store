import Link from "next/link";
import { LanguageSelector } from "@/components/language-selector";
import { CartLink } from "@/components/cart-link";
import { LogoImg } from "@/components/logo-img";
import { loadCategories } from "@/lib/categories-data";
import { text, withLanguage, type Language } from "@/lib/i18n";
import type { BusinessSettings } from "@/lib/settings";
import { getStorefrontCategoryNavigation } from "@/lib/storefront-category-navigation";
import { splitDesktopCategoryNavigation } from "@/lib/storefront-categories";
import type { ProductCategory } from "@/lib/types";

function categoryHref(category: ProductCategory, language: Language, subcategory?: string) {
  const params = new URLSearchParams();
  if (subcategory) params.set("subcategory", subcategory);
  if (language === "en") params.set("lang", "en");
  const query = params.toString();
  return `/${category}${query ? `?${query}` : ""}`;
}

export async function SiteHeader({
  language,
  settings,
}: {
  language: Language;
  settings?: BusinessSettings;
}) {
  const categoryData = await loadCategories();
  const categoryNavigation = getStorefrontCategoryNavigation(categoryData, language);
  const { primary: primaryNavigation, overflow: overflowNavigation } = splitDesktopCategoryNavigation(categoryNavigation);
  const siteName = settings?.business_name || "Online Store";
  const instagramLink = settings?.instagram || "";
  const logoUrl = settings?.logo_url || "";

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-paper/95 shadow-sm shadow-stone-900/[0.03] backdrop-blur-xl">
      <div className="ui-container flex items-center justify-between gap-4 py-3">
        <Link
          className="flex min-w-0 max-w-[58vw] items-center gap-2.5 text-lg font-black tracking-tight text-ink sm:max-w-none lg:shrink-0"
          href={withLanguage("/", language)}
        >
          {logoUrl ? <LogoImg src={logoUrl} alt={siteName} /> : null}
          <span className="truncate">{siteName}</span>
        </Link>

        <nav className="hidden items-center gap-1 xl:flex">
          {primaryNavigation.map((cat) => (
            <div className="group relative" key={cat.slug}>
              <Link
                className="inline-flex rounded-full px-3 py-2 text-sm font-black text-stone-500 transition hover:bg-white hover:text-ink hover:shadow-sm"
                href={categoryHref(cat.slug, language)}
              >
                {cat.label}
              </Link>

              <div className="invisible absolute left-1/2 top-full z-30 w-56 -translate-x-1/2 pt-2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white p-2 shadow-2xl shadow-stone-900/10">
                  <Link
                    className="block rounded-xl px-3 py-2 text-sm font-black text-ink transition hover:bg-stone-100"
                    href={categoryHref(cat.slug, language)}
                  >
                    {text[language].all} {cat.label}
                  </Link>
                  {cat.subcategories.length > 0 ? <div className="my-1 border-t border-stone-100" /> : null}
                  {cat.subcategories.map((sub) => (
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-bold text-stone-600 transition hover:bg-stone-100 hover:text-ink"
                      href={categoryHref(cat.slug, language, sub.slug)}
                      key={sub.slug}
                    >
                      {sub.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {overflowNavigation.length > 0 ? (
            <div className="group relative">
              <button
                aria-haspopup="true"
                className="inline-flex rounded-full px-3 py-2 text-sm font-black text-stone-500 transition hover:bg-white hover:text-ink hover:shadow-sm"
                data-storefront-category-more
                type="button"
              >
                {language === "en" ? "More" : "Περισσότερα"}
              </button>
              <div
                className="invisible absolute right-0 top-full z-30 w-80 pt-2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                data-storefront-category-overflow
              >
                <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-3 shadow-2xl shadow-stone-900/10">
                  {overflowNavigation.map((category) => (
                    <div className="border-b border-stone-100 py-2 last:border-b-0" key={category.slug}>
                      <Link
                        className="block rounded-xl px-3 py-2 text-sm font-black text-ink transition hover:bg-stone-100"
                        href={categoryHref(category.slug, language)}
                      >
                        {category.label}
                      </Link>
                      {category.subcategories.length > 0 ? (
                        <div className="flex flex-wrap gap-1 px-3 pb-1">
                          {category.subcategories.map((subcategory) => (
                            <Link
                              className="rounded-full bg-stone-100 px-2.5 py-1.5 text-xs font-bold text-stone-600 transition hover:bg-stone-200 hover:text-ink"
                              href={categoryHref(category.slug, language, subcategory.slug)}
                              key={subcategory.slug}
                            >
                              {subcategory.label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </nav>

        <div className="flex items-center gap-2">
          {instagramLink ? (
            <a
              className="hidden rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-black text-ink shadow-sm transition hover:border-stone-300 hover:shadow-md md:inline-flex"
              href={instagramLink}
              rel="noreferrer"
              target="_blank"
            >
              Instagram
            </a>
          ) : null}
          <CartLink language={language} />
          <LanguageSelector language={language} />
        </div>
      </div>

      <div className="border-t border-stone-200/60 xl:hidden">
        <details className="group ui-container pb-3 sm:hidden" data-storefront-mobile-categories>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-ink shadow-sm [&::-webkit-details-marker]:hidden">
            <span>{text[language].categories}</span>
            <span className="flex items-center gap-2 text-xs text-stone-500">
              {categoryNavigation.length}
              <span aria-hidden="true" className="text-base transition-transform group-open:rotate-180">⌄</span>
            </span>
          </summary>
          <nav className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-lg shadow-stone-900/5">
            {categoryNavigation.map((cat) => (
              <Link
                className="flex min-h-11 min-w-0 items-center justify-center rounded-xl bg-stone-50 px-3 py-2 text-center text-sm font-black leading-tight text-stone-700 transition hover:bg-stone-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                href={withLanguage(`/${cat.slug}`, language)}
                key={cat.slug}
              >
                <span className="break-words">{cat.label}</span>
              </Link>
            ))}
          </nav>
        </details>

        <nav className="ui-container hidden flex-wrap justify-center gap-2 pb-3 sm:flex xl:hidden">
          {categoryNavigation.map((cat) => (
            <Link
              className="inline-flex min-h-10 items-center rounded-full border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:border-stone-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
              href={withLanguage(`/${cat.slug}`, language)}
              key={cat.slug}
            >
              {cat.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
