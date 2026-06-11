import Link from "next/link";
import { LanguageSelector } from "@/components/language-selector";
import { categoryLabels, text, withLanguage, type Language } from "@/lib/i18n";
import { instagramUrl, siteName, whatsappUrl } from "@/lib/site";
import { categories } from "@/lib/types";

export function SiteHeader({ language }: { language: Language }) {
  const t = text[language];

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link className="text-lg font-black tracking-tight text-ink" href={withLanguage("/", language)}>
          {siteName}
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {categories.map((category) => (
            <Link
              className="rounded-full px-3 py-2 text-sm font-bold text-stone-600 transition hover:bg-white hover:text-ink"
              href={withLanguage(`/${category.slug}`, language)}
              key={category.slug}
            >
              {categoryLabels[category.slug][language]}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            className="hidden rounded-full bg-ink px-4 py-2 text-sm font-bold text-white transition hover:bg-stone-800 sm:inline-flex"
            href={whatsappUrl}
            rel="noreferrer"
            target="_blank"
          >
            WhatsApp
          </a>
          <a
            className="hidden rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-ink transition hover:border-stone-300 md:inline-flex"
            href={instagramUrl}
            rel="noreferrer"
            target="_blank"
          >
            Instagram
          </a>
          <LanguageSelector language={language} />
        </div>
      </div>

      <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden">
        {categories.map((category) => (
          <Link
            className="shrink-0 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-700"
            href={withLanguage(`/${category.slug}`, language)}
            key={category.slug}
          >
            {categoryLabels[category.slug][language]}
          </Link>
        ))}
        <a
          className="shrink-0 rounded-full bg-ink px-3 py-2 text-sm font-bold text-white"
          href={whatsappUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t.contact}
        </a>
      </nav>
    </header>
  );
}
