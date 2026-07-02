import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { getLanguage, localizeHours, text } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";

type ContactPageProps = {
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({
  searchParams,
}: ContactPageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  const t = text[language];
  return {
    title: `${t.contact} | ${settings.business_name}`,
    description:
      language === "en" ? settings.description_en : settings.description_gr || settings.description_en,
    alternates: { canonical: `${siteUrl()}/contact` },
  };
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];
  const settings = await getBusinessSettings();

  const addressText = settings.address || "";
  const phoneText = settings.phone || "";
  const hoursText = localizeHours(settings.opening_hours || "", language);

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="ui-container py-8 sm:py-12 lg:py-16">
        <div className="relative overflow-hidden rounded-[2rem] border border-stone-200/70 bg-white p-6 shadow-sm shadow-stone-900/5 sm:p-8 lg:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(183,95,61,0.08),transparent_32%),radial-gradient(circle_at_90%_0%,rgba(100,115,74,0.10),transparent_34%)]" />
          <div className="relative max-w-3xl">
            <p className="ui-kicker">{settings.business_name}</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">
              {t.contact}
            </h1>
            <p className="mt-4 text-base leading-7 text-stone-600 sm:text-lg">
              {language === "en"
                ? settings.description_en
                : settings.description_gr || settings.description_en}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {settings.whatsapp ? (
                <a
                  className="ui-button-primary"
                  href={settings.whatsapp}
                  rel="noreferrer"
                  target="_blank"
                >
                  WhatsApp
                </a>
              ) : null}
              {settings.instagram ? (
                <a
                  className="ui-button-secondary"
                  href={settings.instagram}
                  rel="noreferrer"
                  target="_blank"
                >
                  Instagram
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {/* Address */}
          {addressText ? (
            <div className="ui-panel p-6 lg:col-span-2">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-ink">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M12 21s7-4.7 7-11a7 7 0 10-14 0c0 6.3 7 11 7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
              </div>
              <h2 className="text-lg font-black text-ink">{t.storeInfo}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {addressText}
              </p>
              {phoneText ? (
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {phoneText}
                </p>
              ) : null}
              {settings.google_maps_url ? (
                <a
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink shadow-sm transition hover:border-ink hover:bg-stone-50"
                  href={settings.google_maps_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t.findOnMaps}
                </a>
              ) : null}
            </div>
          ) : null}

          {/* Hours */}
          {hoursText ? (
            <div className="ui-panel p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-ink">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <h2 className="text-lg font-black text-ink">{t.hours}</h2>
              <div className="mt-2 space-y-1 text-sm leading-6 text-stone-600">
                {hoursText.replace(/\\n/g, "\n").split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          ) : null}

          {/* WhatsApp */}
          {settings.whatsapp ? (
            <div className="ui-panel p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e9f7ef] text-[#247a46]">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M4 19l1.2-4A8 8 0 1112 20a8 8 0 01-3.8-1z" />
                  <path d="M9 9c.5 2 2 3.5 4 4" />
                </svg>
              </div>
              <h2 className="text-lg font-black text-ink">WhatsApp</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {t.contactWhatsApp}
              </p>
              <a
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-black text-white shadow-sm transition hover:bg-stone-800"
                href={settings.whatsapp}
                rel="noreferrer"
                target="_blank"
              >
                {t.contactWhatsApp}
              </a>
            </div>
          ) : null}

          {/* Instagram */}
          {settings.instagram ? (
            <div className="ui-panel p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7edf1] text-terracotta">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="4" y="4" width="16" height="16" rx="5" />
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M17.5 6.5h.01" />
                </svg>
              </div>
              <h2 className="text-lg font-black text-ink">Instagram</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {t.followInstagram}
              </p>
              <a
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300 bg-white px-6 text-sm font-black text-ink shadow-sm transition hover:border-ink hover:bg-stone-50"
                href={settings.instagram}
                rel="noreferrer"
                target="_blank"
              >
                {t.followInstagram}
              </a>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
