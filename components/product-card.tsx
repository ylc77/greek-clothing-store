import Link from "next/link";
import { productName, text, withLanguage, type Language } from "@/lib/i18n";
import type { Product } from "@/lib/types";

export function ProductCard({ product, language }: { product: Product; language: Language }) {
  const t = text[language];
  const name = productName(product, language);

  return (
    <Link
      aria-label={name}
      className="group flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ink/20"
      href={withLanguage(`/product/${encodeURIComponent(product.sku)}`, language)}
    >
      {/* Image */}
      <div className="relative overflow-hidden bg-[#f3efe8]">
        {product.image_url ? (
          <img
            alt={name}
            className="aspect-[4/5] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            src={product.image_url}
          />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center">
            <svg
              className="h-16 w-16 text-stone-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              viewBox="0 0 64 64"
            >
              <path d="M24 22c0-4 3-8 8-8s8 4 8 8" />
              <path d="M14 50V28c0-2 1-4 3-4h30c2 0 3 2 3 4v22" />
              <path d="M20 24l-4-4m24 4l4-4" />
              <path d="M16 50h32v4c0 2-1 3-3 3H19c-2 0-3-1-3-3v-4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col justify-between gap-3 p-3 sm:p-4">
        <p className="line-clamp-2 text-sm font-black leading-5 text-ink sm:text-base sm:leading-6">
          {name}
        </p>
        <div>
          <p className="text-lg font-black text-terracotta sm:text-xl">
            €{Number(product.price).toFixed(2)}
          </p>
          <p className="mt-1 text-xs font-bold text-stone-400">
            {product.stock > 0 ? t.inStock : t.outOfStock}
          </p>
        </div>
      </div>
    </Link>
  );
}
