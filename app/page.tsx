import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { SiteHeader } from "@/components/site-header";
import { categoryLabels, getLanguage, text, withLanguage } from "@/lib/i18n";
import { getLatestProducts } from "@/lib/products";
import { instagramUrl, siteName, whatsappUrl } from "@/lib/site";
import { categories } from "@/lib/types";

type HomePageProps = {
  searchParams: Promise<{
    lang?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const language = getLanguage((await searchParams).lang);
  const t = text[language];
  const { products, error } = await getLatestProducts(8);

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} />

      <section className="relative min-h-[500px] overflow-hidden bg-ink text-white sm:min-h-[560px]">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src="/images/home-hero.png"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/62 via-black/28 to-black/5" />
        <div className="relative mx-auto flex min-h-[500px] max-w-7xl flex-col justify-end px-4 pb-9 pt-24 sm:min-h-[560px] sm:px-6 sm:pb-12 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-white/80">{t.eyebrow}</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl lg:text-7xl">{siteName}</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/88 sm:text-lg">{t.intro}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              className="rounded-full bg-white px-5 py-3 text-sm font-black text-ink transition hover:bg-stone-100"
              href="#latest"
            >
              {t.shopLatest}
            </Link>
            <a
              className="rounded-full border border-white/50 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10"
              href={whatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">{t.categories}</p>
            <h2 className="mt-2 text-2xl font-black text-ink sm:text-3xl">{t.categories}</h2>
          </div>
        </div>
        <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {categories.map((category) => (
            <Link
              className="rounded-md border border-stone-200 bg-white px-4 py-4 text-sm font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink sm:text-center"
              href={withLanguage(`/${category.slug}`, language)}
              key={category.slug}
            >
              {categoryLabels[category.slug][language]}
            </Link>
          ))}
        </nav>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 sm:pb-14 lg:px-8" id="latest">
        <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-olive">{t.latest}</p>
            <h2 className="mt-2 text-3xl font-black text-ink">{t.latest}</h2>
            <p className="mt-2 text-sm text-stone-600">{t.latestText}</p>
          </div>
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
              <ProductCard key={product.sku} product={product} language={language} />
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-stone-200 bg-white/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-7 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-bold text-ink">{siteName}</p>
          <p>
            {t.contact}:{" "}
            <a className="font-bold text-ink" href={whatsappUrl} target="_blank" rel="noreferrer">
              WhatsApp
            </a>{" "}
            /{" "}
            <a className="font-bold text-ink" href={instagramUrl} target="_blank" rel="noreferrer">
              Instagram
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
