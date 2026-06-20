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
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16 lg:px-8">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
          {/* Left: text */}
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-olive">
              {t.eyebrow}
            </p>
            <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl lg:text-6xl">
              {siteName}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600 sm:text-lg">
              {siteIntro}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                className="rounded-full bg-ink px-6 py-3 text-sm font-black text-white transition hover:bg-stone-800"
                href="#new-arrivals"
              >
                {t.heroCTA}
              </Link>
              {settings.whatsapp ? (
                <a
                  className="rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-black text-ink transition hover:border-ink"
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
          <div className="flex items-center justify-center">
            <SafeImage
              alt={siteName}
              className="w-full max-w-lg rounded-lg object-cover shadow-lg aspect-[4/5]"
              src={heroImage}
            />
          </div>
        </div>
      </section>

      {/* ━━━ Categories ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
          <div className="mb-8 text-center">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">
              {t.categories}
            </p>
            <h2 className="mt-2 text-3xl font-black text-ink">
              {t.categories}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((cat) => {
              const img = categoryImages[cat.slug];
              return (
                <Link
                  key={cat.slug}
                  className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                  href={withLanguage(`/${cat.slug}`, language)}
                >
                  <div className="flex aspect-[3/2] items-center justify-center bg-[#f3efe8]">
                    <SafeImage
                      alt={categoryLabels[cat.slug][language]}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      src={img}
                      fallback={
                        <svg
                          className="h-12 w-12 text-stone-300"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1"
                          viewBox="0 0 64 64"
                        >
                          <path d="M14 50V28c0-2 1-4 3-4h30c2 0 3 2 3 4v22M24 22c0-4 3-8 8-8s8 4 8 8M20 24l-4-4m24 4l4-4M16 50h32v4c0 2-1 3-3 3H19c-2 0-3-1-3-3v-4z" />
                        </svg>
                      }
                    />
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-base font-black text-ink group-hover:text-olive transition-colors">
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
      <section id="new-arrivals" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="mb-8 text-center">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">
            {t.newArrivals}
          </p>
          <h2 className="mt-2 text-3xl font-black text-ink">
            {t.newArrivals}
          </h2>
        </div>

        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <strong>{t.cannotLoad}</strong>
            <p className="mt-2">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
            {t.noProducts}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 sm:gap-6">
            {products.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                language={language}
              />
            ))}
          </div>
        )}

        <div className="mt-10 text-center">
          <Link
            className="inline-block rounded-full border border-stone-300 bg-white px-8 py-3 text-sm font-black text-ink transition hover:border-ink"
            href={withLanguage("/women", language)}
          >
            {t.browseCollection}
          </Link>
        </div>
      </section>

      {/* ━━━ How to Buy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-black text-ink">
              {t.howToBuy}
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: t.step1Title, desc: t.step1Desc, icon: "👀" },
              { title: t.step2Title, desc: t.step2Desc, icon: "💬" },
              { title: t.step3Title, desc: t.step3Desc, icon: "🏪" },
              { title: t.step4Title, desc: t.step4Desc, icon: "📦" },
            ].map((step, i) => (
              <div
                key={i}
                className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-sm"
              >
                <p className="text-3xl">{step.icon}</p>
                <p className="mt-3 text-base font-black text-ink">
                  {step.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━ Store Info Cards ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {settings.address ? (
        <section className="border-t border-stone-200 bg-stone-50/50">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
            <div className="mb-8 text-center">
              <h2 className="text-3xl font-black text-ink">
                {t.storeInfo}
              </h2>
            </div>

            <div className="grid gap-6 sm:grid-cols-3">
              {/* Address */}
              <div className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-sm">
                <p className="text-2xl">📍</p>
                <p className="mt-3 text-sm font-black text-ink">
                  {t.storeInfo}
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  {settings.address}
                </p>
                {settings.google_maps_url ? (
                  <a
                    className="mt-4 inline-block text-sm font-bold text-ink underline underline-offset-4 hover:text-olive"
                    href={settings.google_maps_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t.findOnMaps}
                  </a>
                ) : null}
              </div>

              {/* Hours */}
              {settings.opening_hours ? (
                <div className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-sm">
                  <p className="text-2xl">🕐</p>
                  <p className="mt-3 text-sm font-black text-ink">
                    {t.hours}
                  </p>
                  <div className="mt-2 space-y-1 text-sm leading-6 text-stone-600">
                    {settings.opening_hours.replace(/\\n/g, "\n").split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              ) : (
                <div />
              )}

              {/* Contact */}
              <div className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-sm">
                <p className="text-2xl">💬</p>
                <p className="mt-3 text-sm font-black text-ink">
                  {t.contact}
                </p>
                {settings.whatsapp ? (
                  <a
                    className="mt-2 block text-sm font-bold text-ink hover:text-olive"
                    href={settings.whatsapp}
                    rel="noreferrer"
                    target="_blank"
                  >
                    WhatsApp
                  </a>
                ) : null}
                {settings.instagram ? (
                  <a
                    className="mt-1 block text-sm font-bold text-ink hover:text-olive"
                    href={settings.instagram}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Instagram
                  </a>
                ) : null}
                {settings.google_maps_url ? (
                  <a
                    className="mt-1 block text-sm font-bold text-ink hover:text-olive"
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
        </section>
      ) : null}

      {/* ━━━ Footer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <footer className="border-t border-stone-200 bg-stone-100/80">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-6 text-sm text-stone-500 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <p>
            {settings.business_name} · {settings.address?.split(",")[0] || "Athens"}
          </p>
          <p>{settings.footer_text || `© ${new Date().getFullYear()} ${settings.business_name}`}</p>
        </div>
      </footer>
    </main>
  );
}
