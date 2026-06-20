import Link from "next/link";
import type { Metadata } from "next";
import { ProductCard } from "@/components/product-card";
import { SafeImage } from "@/components/safe-image";
import { SiteHeader } from "@/components/site-header";
import { categoryLabels, getLanguage, text, withLanguage } from "@/lib/i18n";
import { getCategoryImages, getLatestProducts } from "@/lib/products";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { categories } from "@/lib/types";

type HomePageProps = {
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  const t = text[language];
  return {
    title: settings.business_name,
    description:
      language === "en"
        ? settings.description_en
        : settings.description_gr || settings.description_en,
    alternates: { canonical: siteUrl() },
    openGraph: {
      title: settings.business_name,
      description: t.intro,
      siteName: settings.business_name,
      type: "website",
    },
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];
  const settings = await getBusinessSettings();
  const { products, error } = await getLatestProducts(4);
  const categoryImages = await getCategoryImages();

  const siteName = settings.business_name;
  const siteIntro =
    language === "en"
      ? settings.description_en
      : settings.description_gr || settings.description_en;
  const heroImage = settings.hero_image_url || "";

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />

      {/* ━━━ Hero ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="mx-auto max-w-7xl px-4 pt-8 pb-12 sm:px-6 sm:pt-14 sm:pb-16 lg:py-24 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
          {/* Left: text */}
          <div className="flex flex-col justify-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-olive">
              {t.eyebrow}
            </p>
            <h1 className="mt-5 text-5xl font-black leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              {siteName}
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-stone-500 sm:text-lg">
              {siteIntro}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="inline-flex h-12 items-center rounded-full bg-ink px-7 text-sm font-bold text-white hover:bg-stone-800"
                href="#new-arrivals"
              >
                {t.heroCTA}
              </Link>
              {settings.whatsapp ? (
                <a
                  className="inline-flex h-12 items-center rounded-full border border-stone-300 bg-white px-7 text-sm font-bold text-ink hover:border-ink hover:bg-stone-50"
                  href={settings.whatsapp}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t.heroWhatsApp}
                </a>
              ) : null}
            </div>
          </div>

          {/* Right: image */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="w-full max-w-lg">
              <SafeImage
                alt={siteName}
                className="aspect-[4/5] w-full rounded-2xl object-cover shadow-2xl shadow-stone-900/10"
                src={heroImage}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ Categories ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="border-t border-stone-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="mb-10 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-olive">
              {t.categories}
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">
              {t.categories}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((cat) => {
              const img = categoryImages[cat.slug];
              return (
                <Link
                  key={cat.slug}
                  className="group relative overflow-hidden rounded-xl border border-stone-100 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-stone-900/5"
                  href={withLanguage(`/${cat.slug}`, language)}
                >
                  <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-[#f3efe8]">
                    <SafeImage
                      alt={categoryLabels[cat.slug][language]}
                      className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                      loading="lazy"
                      src={img}
                    />
                    {/* gradient overlay for text readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    <p className="absolute bottom-0 left-0 right-0 p-4 text-base font-bold tracking-wide text-white sm:text-lg">
                      {categoryLabels[cat.slug][language]}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ━━━ New Arrivals ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section id="new-arrivals" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-olive">
            {t.newArrivals}
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">
            {t.newArrivals}
          </h2>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <strong>{t.cannotLoad}</strong>
            <p className="mt-2">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white py-16 text-center text-stone-400">
            {t.noProducts}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 sm:gap-6">
            {products.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                language={language}
              />
            ))}
          </div>
        )}

        <div className="mt-12 text-center">
          <Link
            className="inline-flex h-11 items-center rounded-full border border-stone-300 bg-white px-8 text-sm font-bold text-ink hover:border-ink hover:bg-stone-50"
            href={withLanguage("/women", language)}
          >
            {t.browseCollection}
          </Link>
        </div>
      </section>

      {/* ━━━ How to Buy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="border-t border-stone-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">
              {t.howToBuy}
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: t.step1Title, desc: t.step1Desc },
              { title: t.step2Title, desc: t.step2Desc },
              { title: t.step3Title, desc: t.step3Desc },
              { title: t.step4Title, desc: t.step4Desc },
            ].map((step, i) => (
              <div key={i} className="group flex flex-col items-center text-center">
                {/* numbered circle */}
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-lg font-bold text-white transition group-hover:bg-stone-800">
                  {i + 1}
                </div>
                <p className="mt-5 text-base font-black text-ink">
                  {step.title}
                </p>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-stone-500">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━ Why choose us ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="border-t border-stone-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">{t.whyUs}</h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100">
                <svg className="h-6 w-6 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
              </div>
              <p className="mt-4 text-base font-black text-ink">{t.whyLocal}</p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-stone-500">{t.whyLocalDesc}</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100">
                <svg className="h-6 w-6 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
              </div>
              <p className="mt-4 text-base font-black text-ink">{t.whySkroutz}</p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-stone-500">{t.whySkroutzDesc}</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100">
                <svg className="h-6 w-6 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 15v-2a7 7 0 00-7-7H10a7 7 0 00-7 7v2m18 0a2 2 0 00-2-2H8a2 2 0 00-2 2v0a2 2 0 002 2h11a2 2 0 002-2z"/></svg>
              </div>
              <p className="mt-4 text-base font-black text-ink">{t.whyContact}</p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-stone-500">{t.whyContactDesc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ Store Info Cards ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {settings.address ? (
        <section className="border-t border-stone-100 bg-stone-50/50">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
            <div className="mb-10 text-center">
              <h2 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">
                {t.storeInfo}
              </h2>
            </div>

            <div className="grid gap-6 sm:grid-cols-3">
              {/* Address */}
              <div className="flex flex-col items-center rounded-xl border border-stone-100 bg-white p-8 text-center shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
                  <svg className="h-5 w-5 text-stone-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                </div>
                <p className="mt-4 text-sm font-black text-ink">{t.storeInfo}</p>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{settings.address}</p>
                {settings.google_maps_url ? (
                  <a
                    className="mt-4 text-xs font-bold text-ink underline underline-offset-4 hover:text-olive"
                    href={settings.google_maps_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t.findOnMaps}
                  </a>
                ) : null}
              </div>

              {/* Hours */}
              <div className="flex flex-col items-center rounded-xl border border-stone-100 bg-white p-8 text-center shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
                  <svg className="h-5 w-5 text-stone-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
                <p className="mt-4 text-sm font-black text-ink">{t.hours}</p>
                {settings.opening_hours ? (
                  <div className="mt-2 space-y-0.5 text-sm leading-relaxed text-stone-500">
                    {settings.opening_hours.replace(/\\n/g, "\n").split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Contact */}
              <div className="flex flex-col items-center rounded-xl border border-stone-100 bg-white p-8 text-center shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
                  <svg className="h-5 w-5 text-stone-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v-2a7 7 0 00-7-7H10a7 7 0 00-7 7v2m18 0a2 2 0 00-2-2H8a2 2 0 00-2 2v0a2 2 0 002 2h11a2 2 0 002-2z" />
                  </svg>
                </div>
                <p className="mt-4 text-sm font-black text-ink">{t.contact}</p>
                <div className="mt-2 space-y-1">
                  {settings.whatsapp ? (
                    <a
                      className="block text-sm font-bold text-ink hover:text-olive"
                      href={settings.whatsapp}
                      rel="noreferrer"
                      target="_blank"
                    >
                      WhatsApp
                    </a>
                  ) : null}
                  {settings.instagram ? (
                    <a
                      className="block text-sm font-bold text-ink hover:text-olive"
                      href={settings.instagram}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Instagram
                    </a>
                  ) : null}
                  {settings.google_maps_url ? (
                    <a
                      className="block text-sm font-bold text-ink hover:text-olive"
                      href={settings.google_maps_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Google Maps
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ━━━ Footer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <footer className="border-t border-stone-100 bg-stone-100/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 py-8 text-center text-xs text-stone-400 sm:px-6 sm:py-10 lg:px-8">
          <p className="text-sm font-bold text-stone-600">{settings.business_name}</p>
          {settings.address ? (
            <p>{settings.address}</p>
          ) : null}
          <p className="mt-1">
            {settings.footer_text || `© ${new Date().getFullYear()} ${settings.business_name}`}
          </p>
        </div>
      </footer>
    </main>
  );
}
