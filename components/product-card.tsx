import Link from "next/link";
import { OptimizedImage } from "@/components/optimized-image";
import { productName, text, withLanguage, type Language } from "@/lib/i18n";
import { getTotalStock as effectiveStock } from "@/lib/product-stock";
import { productSizeLabels } from "@/lib/category-product-filters";
import type { Product } from "@/lib/types";

export function ProductCard({
  product,
  language,
  displayMode = "default",
}: {
  product: Product;
  language: Language;
  displayMode?: "default" | "catalog";
}) {
  const t = text[language];
  const name = productName(product, language);
  const stock = effectiveStock(product);
  const sizes = displayMode === "catalog" ? productSizeLabels(product).slice(0, 5) : [];

  return (
    <Link
      aria-label={name}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm shadow-stone-900/5 transition duration-300 hover:-translate-y-1 hover:border-stone-300 hover:shadow-xl hover:shadow-stone-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
      href={withLanguage(`/product/${encodeURIComponent(product.sku)}`, language)}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-[#f3efe8]">
        <OptimizedImage
          alt={name}
          className="absolute inset-0"
          fill
          imageClassName="object-cover object-center transition duration-500 group-hover:scale-[1.04]"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 20vw"
          src={product.image_url}
        />
        <span
          className={`absolute left-3 top-3 rounded-full px-3 py-1 text-[11px] font-black shadow-sm ${
            stock > 0 ? "bg-white/90 text-ink" : "bg-stone-900/75 text-white"
          }`}
        >
          {stock > 0 ? t.inStock : t.outOfStock}
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 p-3 sm:p-4">
        <p className="line-clamp-2 min-h-10 text-sm font-black leading-5 text-ink sm:text-[15px]">
          {name}
        </p>
        {sizes.length > 0 ? (
          <div className="flex min-h-6 flex-wrap gap-1.5" aria-label={language === "el" ? "Διαθέσιμα μεγέθη" : "Available sizes"}>
            {sizes.map((size) => (
              <span className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-black text-stone-600" key={size}>{size}</span>
            ))}
          </div>
        ) : null}
        <div className="flex min-w-0 items-end justify-between gap-2">
          <p className="text-lg font-black leading-none text-[#a14b2f] sm:text-xl sm:text-terracotta">
            €{Number(product.price).toFixed(2)}
          </p>
          {displayMode === "default" ? (
            <span className="max-w-[45%] truncate rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">
              {product.category}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
