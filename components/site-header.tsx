import Link from "next/link";
import { LanguageSelector } from "@/components/language-selector";
import { categoryLabels, withLanguage, type Language } from "@/lib/i18n";
import { categories } from "@/lib/types";
import type { BusinessSettings } from "@/lib/settings";

export function SiteHeader({
  language,
  settings,
}: {
  language: Language;
  settings?: BusinessSettings;
}) {
  const siteName = settings?.business_name || "Our Store";
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

        {/* Center: category links */}
        <nav className="hidden items-center gap-1 lg:flex">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              className="rounded-full px-3 py-2 text-sm font-bold text-stone-600 transition hover:bg-white hover:text-ink"
              href={withLanguage(`/${cat.slug}`, language)}
            >
              {categoryLabels[cat.slug][language]}
            </Link>
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
