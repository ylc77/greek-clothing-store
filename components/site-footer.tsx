import Link from "next/link";
import { legalLinks } from "@/lib/legal";
import { withLanguage, type Language } from "@/lib/i18n";
import type { BusinessSettings } from "@/lib/settings";

export function SiteFooter({
  language,
  settings,
}: {
  language: Language;
  settings: BusinessSettings;
}) {
  return (
    <footer className="border-t border-stone-100 bg-stone-100/60">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-8 text-center text-xs text-stone-500 sm:px-6 sm:py-10 lg:px-8">
        <p className="text-sm font-bold text-stone-700">{settings.business_name}</p>
        {settings.address ? <p>{settings.address}</p> : null}
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {legalLinks.map((link) => (
            <Link
              className="font-bold text-stone-500 transition hover:text-ink"
              href={withLanguage(link.href, language)}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="mt-1">
          {settings.footer_text || `© ${new Date().getFullYear()} ${settings.business_name}`}
        </p>
      </div>
    </footer>
  );
}
