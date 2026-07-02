import Link from "next/link";
import { SafeImage } from "@/components/safe-image";
import { productName, text, withLanguage, type Language } from "@/lib/i18n";
import { effectiveStock } from "@/lib/products";
import type { Product } from "@/lib/types";

export function ProductCard({ product, language }: { product: Product; language: Language }) {
  const t = text[language];
  const name = productName(product, language);
  const stock = effectiveStock(product);

  return (
    <Link
      aria-label={name}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm shadow-stone-900/5 transition duration-300 hover:-translate-y-1 hover:border-stone-300 hover:shadow-xl hover:shadow-stone-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
      href={withLanguage(`/product/${encodeURIComponent(product.sku)}`, language)}
    >
      <div className="relative overflow-hidden bg-[#f3efe8]">
        <SafeImage
          alt={name}
          className="aspect-[3/4] w-full object-cover object-center transition duration-500 group-hover:scale-[1.04]"
          loading="lazy"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
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
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-lg font-black leading-none text-terracotta sm:text-xl">
            €{Number(product.price).toFixed(2)}
          </p>
          <span className="max-w-full truncate rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-500 sm:max-w-[45%]">
            {product.category}
          </span>
        </div>
      </div>
    </Link>
  );
}
