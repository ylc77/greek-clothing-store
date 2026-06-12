import Link from "next/link";
import { productName, text, withLanguage, type Language } from "@/lib/i18n";
import type { Product } from "@/lib/types";

export function ProductCard({ product, language }: { product: Product; language: Language }) {
  const t = text[language];
  const name = productName(product, language);

  return (
    <Link
      aria-label={name}
      className="group block overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ink/20"
      href={withLanguage(`/product/${encodeURIComponent(product.sku)}`, language)}
    >
      <div className="relative overflow-hidden bg-stone-100">
        {product.image_url ? (
          <img
            alt={name}
            className="aspect-[4/5] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            src={product.image_url}
          />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center bg-stone-100 text-xs font-bold text-stone-400">
            No image
          </div>
        )}
      </div>
      <div className="grid min-h-[116px] content-between gap-3 p-3 sm:min-h-[132px] sm:p-4">
        <p className="line-clamp-2 text-sm font-black leading-5 text-ink sm:text-base sm:leading-6">
          {name}
        </p>
        <div>
          <p className="text-lg font-black text-terracotta sm:text-xl">€{Number(product.price).toFixed(2)}</p>
          <p className="mt-1 text-xs font-bold text-stone-500">
            {product.stock > 0 ? t.inStock : t.outOfStock}
          </p>
        </div>
      </div>
    </Link>
  );
}
