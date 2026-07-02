import Link from "next/link";
import { LanguageSelector } from "@/components/language-selector";
import { LogoImg } from "@/components/logo-img";
import { categoryLabels, subcategoryLabels, text, withLanguage, type Language } from "@/lib/i18n";
import { categories, subcategoryList, type ProductCategory } from "@/lib/types";
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
          {categories.map((cat) => (
            <div className="group relative" key={cat.slug}>
              <Link
                className="inline-flex rounded-full px-3 py-2 text-sm font-black text-stone-500 transition hover:bg-white hover:text-ink hover:shadow-sm"
                href={categoryHref(cat.slug, language)}
              >
                {categoryLabels[cat.slug][language]}
              </Link>

              <div className="invisible absolute left-1/2 top-full z-30 w-56 -translate-x-1/2 pt-2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100">
                <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white p-2 shadow-2xl shadow-stone-900/10">
                  <Link
                    className="block rounded-xl px-3 py-2 text-sm font-black text-ink transition hover:bg-stone-100"
                    href={categoryHref(cat.slug, language)}
                  >
                    {text[language].all} {categoryLabels[cat.slug][language]}
                  </Link>
                  <div className="my-1 border-t border-stone-100" />
                  {subcategoryList[cat.slug].map((sub) => (
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-bold text-stone-600 transition hover:bg-stone-100 hover:text-ink"
                      href={categoryHref(cat.slug, language, sub)}
                      key={sub}
                    >
                      {subcategoryLabels[sub]?.[language] || sub}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
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
          <LanguageSelector language={language} />
        </div>
      </div>

      <div className="relative xl:hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-paper to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-paper to-transparent" />
        <div className="pointer-events-none absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-stone-200 bg-white/95 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-stone-500 shadow-sm min-[420px]:block">
          Swipe →
        </div>
        <nav className="ui-container scrollbar-none flex snap-x gap-2 overflow-x-auto pb-3 pr-20 sm:pr-24 lg:justify-center lg:gap-1.5 xl:hidden">
          {categories.map((cat) => (
            <Link
              className="shrink-0 snap-start rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-black text-stone-700 shadow-sm whitespace-nowrap transition hover:border-stone-300 active:scale-[0.98] lg:px-2.5 lg:text-xs"
              href={withLanguage(`/${cat.slug}`, language)}
              key={cat.slug}
            >
              {categoryLabels[cat.slug][language]}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
