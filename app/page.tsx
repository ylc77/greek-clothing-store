import Link from "next/link";
import { categoryLabels, getLanguage, productName, text, withLanguage } from "@/lib/i18n";
import { getLatestProducts } from "@/lib/products";
import { categories } from "@/lib/types";

const whatsappUrl = "https://wa.me/306900000000";
const instagramUrl = "https://instagram.com/";

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
      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-stone-200 pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-olive">
              {t.eyebrow}
            </p>
            <h1 className="mt-2 text-4xl font-bold text-ink sm:text-5xl">Helios Wear</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
              {t.intro}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className={`rounded-md border px-4 py-3 text-sm font-bold ${language === "el" ? "border-ink bg-ink text-white" : "border-stone-300 text-ink"}`}
              href="/"
            >
              EL
            </Link>
            <Link
              className={`rounded-md border px-4 py-3 text-sm font-bold ${language === "en" ? "border-ink bg-ink text-white" : "border-stone-300 text-ink"}`}
              href="/?lang=en"
            >
              EN
            </Link>
            <a
              className="rounded-md bg-ink px-4 py-3 text-sm font-bold text-white"
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <a
              className="rounded-md border border-stone-300 px-4 py-3 text-sm font-bold text-ink"
              href={instagramUrl}
              target="_blank"
              rel="noreferrer"
            >
              Instagram
            </a>
          </div>
        </header>

        <nav className="flex flex-wrap gap-3">
          {categories.map((category) => (
            <Link
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold"
              href={withLanguage(`/${category.slug}`, language)}
              key={category.slug}
            >
              {categoryLabels[category.slug][language]}
            </Link>
          ))}
        </nav>

        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-ink">{t.latest}</h2>
              <p className="mt-1 text-sm text-stone-600">{t.latestText}</p>
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <Link
                  className="overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm"
                  href={withLanguage(`/${product.category}`, language)}
                  key={product.sku}
                >
                  <img
                    alt={productName(product, language)}
                    className="aspect-[4/5] w-full object-cover"
                    src={product.image_url}
                  />
                  <div className="p-3">
                    <p className="line-clamp-2 min-h-10 text-sm font-bold text-ink">
                      {productName(product, language)}
                    </p>
                    <p className="mt-2 text-base font-extrabold text-terracotta">
                      €{Number(product.price).toFixed(2)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <footer className="border-t border-stone-200 py-6 text-sm text-stone-600">
          {t.contact}:{" "}
          <a className="font-bold text-ink" href={whatsappUrl} target="_blank" rel="noreferrer">
            WhatsApp
          </a>{" "}
          /{" "}
          <a className="font-bold text-ink" href={instagramUrl} target="_blank" rel="noreferrer">
            Instagram
          </a>
        </footer>
      </section>
    </main>
  );
}
