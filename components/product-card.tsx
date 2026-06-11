import Link from "next/link";
import { productName, text, withLanguage, type Language } from "@/lib/i18n";
import type { Product } from "@/lib/types";

export function ProductCard({ product, language }: { product: Product; language: Language }) {
  const t = text[language];

  return (
    <Link
      className="group overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      href={withLanguage(`/product/${encodeURIComponent(product.sku)}`, language)}
    >
      <div className="overflow-hidden bg-stone-100">
        <img
          alt={productName(product, language)}
          className="aspect-[4/5] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          src={product.image_url}
        />
      </div>
      <div className="p-3 sm:p-4">
        <p className="line-clamp-2 min-h-10 text-sm font-bold leading-5 text-ink">
          {productName(product, language)}
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-lg font-black text-terracotta">€{Number(product.price).toFixed(2)}</p>
            <p className="mt-1 text-xs font-bold text-stone-500">
              {product.stock > 0 ? t.inStock : t.outOfStock}
            </p>
          </div>
          <span className="rounded-full border border-stone-200 px-3 py-2 text-xs font-bold text-ink transition group-hover:border-ink">
            {t.viewDetails}
          </span>
        </div>
      </div>
    </Link>
  );
}
