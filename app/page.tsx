import Link from "next/link";
import type { Metadata } from "next";
import { ProductCard } from "@/components/product-card";
import { SiteHeader } from "@/components/site-header";
import { categoryLabels, getLanguage, text, withLanguage } from "@/lib/i18n";
import { getLatestProducts } from "@/lib/products";
import {
  googleMapsUrl,
  instagramUrl,
  siteName,
  siteUrl,
  whatsappUrl
} from "@/lib/site";
import { categories } from "@/lib/types";

type HomePageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export async function generateMetadata({
  searchParams
}: HomePageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];
  return {
    title: siteName,
    description: t.intro,
    alternates: { canonical: siteUrl() },
    openGraph: {
      title: siteName,
      description: t.intro,
      siteName,
      type: "website"
    }
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];
  const { products, error } = await getLatestProducts(8);

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} />

      {/* ── Hero ─────────────────────────────── */}
      <section className="relative min-h-[500px] overflow-hidden bg-ink text-white sm:min-h-[620px]">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src="/images/home-hero.png"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/62 via-black/28 to-black/5" />
        <div className="relative mx-auto flex min-h-[500px] max-w-7xl flex-col justify-end px-4 pb-10 pt-24 sm:min-h-[620px] sm:px-6 sm:pb-14 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-white/80">
            {t.eyebrow}
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl lg:text-7xl">
            {siteName}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/88 sm:text-lg">
            {t.intro}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              className="rounded-full bg-white px-6 py-3 text-sm font-black text-ink transition hover:bg-stone-100"
              href="#categories"
            >
              {t.viewProducts}
            </a>
            <a
              className="rounded-full border border-white/50 px-6 py-3 text-sm font-black text-white transition hover:bg-white/10"
              href={whatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t.contactWhatsApp}
            </a>
          </div>
        </div>
      </section>

      {/* ── Brand intro ───────────────────────── */}
      <section className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6 sm:py-16 lg:px-8">
        <h2 className="text-2xl font-black text-ink sm:text-3xl">
          {t.brandHeading}
        </h2>
        <p className="mt-4 text-base leading-7 text-stone-600 sm:text-lg sm:leading-8">
          {t.brandIntro}
        </p>
      </section>

      {/* ── Categories ────────────────────────── */}
      <section
        className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
        id="categories"
      >
        <div className="mb-5">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">
            {t.categories}
          </p>
          <h2 className="mt-2 text-2xl font-black text-ink sm:text-3xl">
            {t.categories}
          </h2>
        </div>
        <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {categories.map((category) => (
            <Link
              className="rounded-md border border-stone-200 bg-white px-5 py-5 text-base font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink sm:text-center"
              href={withLanguage(`/${category.slug}`, language)}
              key={category.slug}
            >
              {categoryLabels[category.slug][language]}
            </Link>
          ))}
        </nav>
      </section>

      {/* ── New Arrivals ──────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 sm:pb-14 lg:px-8">
        <div className="mb-5 sm:mb-6">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">
            {t.newArrivals}
          </p>
          <h2 className="mt-2 text-3xl font-black text-ink">{t.newArrivals}</h2>
        </div>

        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <strong>{t.cannotLoad}</strong>
            <p className="mt-2">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-stone-600">
            {t.noProducts}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                language={language}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Store info ────────────────────────── */}
      <section className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-xl font-black text-ink sm:text-2xl">
                {t.storeInfo}
              </h2>
              <p className="mt-4 text-sm leading-7 text-stone-600">
                {t.storeAddress}
              </p>
              <div className="mt-4 text-sm leading-7 text-stone-600">
                <p className="font-bold text-ink">{t.hours}</p>
                {t.storeHours.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
              <a
                className="mt-5 inline-block rounded-full border border-stone-300 px-5 py-2 text-sm font-bold text-ink transition hover:border-ink"
                href={googleMapsUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t.findOnMaps}
              </a>
            </div>
            <div className="flex flex-col justify-center gap-4 rounded-md bg-stone-50 p-6">
              <p className="text-sm font-bold text-stone-600">
                {t.storeDescription}
              </p>
              <a
                className="inline-flex items-center gap-2 text-sm font-bold text-ink hover:text-olive"
                href={whatsappUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t.contactWhatsApp}
              </a>
              <a
                className="inline-flex items-center gap-2 text-sm font-bold text-ink hover:text-olive"
                href={instagramUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t.followInstagram}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────── */}
      <footer className="border-t border-stone-200 bg-stone-100/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-bold text-ink">{t.copyright}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a
              className="font-bold text-ink hover:text-olive"
              href={whatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              WhatsApp
            </a>
            <a
              className="font-bold text-ink hover:text-olive"
              href={instagramUrl}
              rel="noreferrer"
              target="_blank"
            >
              Instagram
            </a>
            <a
              className="font-bold text-ink hover:text-olive"
              href={googleMapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              Google Maps
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
