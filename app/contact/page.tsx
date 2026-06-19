import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { getLanguage, text } from "@/lib/i18n";
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
  const hoursText = settings.opening_hours || "";

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <h1 className="text-3xl font-black text-ink sm:text-4xl">
          {t.contact}
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          {language === "en"
            ? settings.description_en
            : settings.description_gr || settings.description_en}
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {/* Address */}
          {addressText ? (
            <div className="rounded-md border border-stone-200 bg-white p-6">
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
                  className="mt-4 inline-block rounded-full border border-stone-300 px-5 py-2 text-sm font-bold text-ink transition hover:border-ink"
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
            <div className="rounded-md border border-stone-200 bg-white p-6">
              <h2 className="text-lg font-black text-ink">{t.hours}</h2>
              <div className="mt-2 space-y-1 text-sm leading-6 text-stone-600">
                {hoursText.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          ) : null}

          {/* WhatsApp */}
          {settings.whatsapp ? (
            <div className="rounded-md border border-stone-200 bg-white p-6">
              <h2 className="text-lg font-black text-ink">WhatsApp</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {t.contactWhatsApp}
              </p>
              <a
                className="mt-4 inline-block rounded-full bg-ink px-6 py-3 text-sm font-black text-white transition hover:bg-stone-800"
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
            <div className="rounded-md border border-stone-200 bg-white p-6">
              <h2 className="text-lg font-black text-ink">Instagram</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {t.followInstagram}
              </p>
              <a
                className="mt-4 inline-block rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-black text-ink transition hover:border-ink"
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
