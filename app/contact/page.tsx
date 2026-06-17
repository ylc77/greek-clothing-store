import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { getLanguage, text } from "@/lib/i18n";
import {
  googleMapsUrl,
  instagramUrl,
  siteName,
  siteUrl,
  storeAddress,
  storePhone,
  whatsappUrl,
} from "@/lib/site";

type ContactPageProps = {
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({
  searchParams,
}: ContactPageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];
  return {
    title: `${t.contact} | ${siteName}`,
    description: t.storeDescription,
    alternates: { canonical: `${siteUrl()}/contact` },
  };
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} />

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <h1 className="text-3xl font-black text-ink sm:text-4xl">
          {t.contact}
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          {t.storeDescription}
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {/* Address */}
          <div className="rounded-md border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-black text-ink">{t.storeAddress}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {storeAddress}
            </p>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              {storePhone}
            </p>
            <a
              className="mt-4 inline-block rounded-full border border-stone-300 px-5 py-2 text-sm font-bold text-ink transition hover:border-ink"
              href={googleMapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t.findOnMaps}
            </a>
          </div>

          {/* Hours */}
          <div className="rounded-md border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-black text-ink">{t.hours}</h2>
            <div className="mt-2 space-y-1 text-sm leading-6 text-stone-600">
              {t.storeHours.split("\n").map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>

          {/* WhatsApp */}
          <div className="rounded-md border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-black text-ink">WhatsApp</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {t.contactWhatsApp}
            </p>
            <a
              className="mt-4 inline-block rounded-full bg-ink px-6 py-3 text-sm font-black text-white transition hover:bg-stone-800"
              href={whatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t.contactWhatsApp}
            </a>
          </div>

          {/* Instagram */}
          <div className="rounded-md border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-black text-ink">Instagram</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {t.followInstagram}
            </p>
            <a
              className="mt-4 inline-block rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-black text-ink transition hover:border-ink"
              href={instagramUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t.followInstagram}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
