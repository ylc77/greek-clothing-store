import Link from "next/link";
import { LanguageSelector } from "@/components/language-selector";
import { categoryLabels, subcategoryLabels, text, withLanguage, type Language } from "@/lib/i18n";
import { categories, subcategoriesByCategory, type ProductCategory } from "@/lib/types";
import type { BusinessSettings } from "@/lib/settings";

function categoryHref(category: ProductCategory, language: Language, subcategory?: string) {
  const params = new URLSearchParams();
  if (subcategory) params.set("subcategory", subcategory);
  if (language === "en") params.set("lang", "en");
  const query = params.toString();
  return `/${category}${query ? `?${query}` : ""}`;
}

export function SiteHeader({
  language,
  settings,
}: {
  language: Language;
  settings?: BusinessSettings;
}) {
  const siteName = settings?.business_name || "Fashion Boutique";
  const instagramLink = settings?.instagram || "";

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        {/* Left: brand name */}
        <Link
          className="text-lg font-black tracking-tight text-ink shrink-0"
          href={withLanguage("/", language)}
        >
          {siteName}
        </Link>

        {/* Center: category links with subcategory dropdown */}
        <nav className="hidden items-center gap-1 lg:flex">
          {categories.map((cat) => (
            <div className="group relative" key={cat.slug}>
              <Link
                className="inline-flex rounded-full px-3 py-2 text-sm font-bold text-stone-600 transition hover:bg-white hover:text-ink"
                href={categoryHref(cat.slug, language)}
              >
                {categoryLabels[cat.slug][language]}
              </Link>

              {/* Subcategory dropdown */}
              <div className="invisible absolute left-1/2 top-full z-30 w-52 -translate-x-1/2 pt-2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100">
                <div className="overflow-hidden rounded-lg border border-stone-200 bg-white p-2 shadow-xl shadow-stone-900/10">
                  <Link
                    className="block rounded-md px-3 py-2 text-sm font-black text-ink transition hover:bg-stone-100"
                    href={categoryHref(cat.slug, language)}
                  >
                    {text[language].all} {categoryLabels[cat.slug][language]}
                  </Link>
                  <div className="my-1 border-t border-stone-100" />
                  {subcategoriesByCategory[cat.slug].map((sub) => (
                    <Link
                      className="block rounded-md px-3 py-2 text-sm font-bold text-stone-600 transition hover:bg-stone-100 hover:text-ink"
                      href={categoryHref(cat.slug, language, sub)}
                      key={sub}
                    >
                      {subcategoryLabels[sub][language]}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </nav>

        {/* Right: Instagram + Language */}
        <div className="flex items-center gap-2">
          {instagramLink ? (
            <a
              className="hidden rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-ink transition hover:border-stone-300 md:inline-flex"
              href={instagramLink}
              rel="noreferrer"
              target="_blank"
            >
              Instagram
            </a>
          ) : null}
          <LanguageSelector language={language} />
        </div>
      </div>

      {/* Mobile: horizontal scroll category row */}
      <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 scrollbar-none sm:px-6 lg:hidden">
        {categories.map((cat) => (
          <Link
            className="shrink-0 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-700 whitespace-nowrap"
            href={withLanguage(`/${cat.slug}`, language)}
            key={cat.slug}
          >
            {categoryLabels[cat.slug][language]}
          </Link>
        ))}
      </nav>
    </header>
  );
}
