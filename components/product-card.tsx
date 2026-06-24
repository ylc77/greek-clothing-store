import Link from "next/link";
import { SafeImage } from "@/components/safe-image";
import { productName, text, withLanguage, type Language } from "@/lib/i18n";
import { effectiveStock } from "@/lib/products";
import type { Product } from "@/lib/types";

export function ProductCard({ product, language }: { product: Product; language: Language }) {
  const t = text[language];
  const name = productName(product, language);

  return (
    <Link
      aria-label={name}
      className="group flex flex-col overflow-hidden rounded-xl border border-stone-100 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-stone-900/5"
      href={withLanguage(`/product/${encodeURIComponent(product.sku)}`, language)}
    >
      {/* Image */}
      <div className="relative overflow-hidden bg-[#f3efe8]">
        <SafeImage
          alt={name}
          className="aspect-[3/4] w-full object-cover object-center transition duration-500 group-hover:scale-[1.04]"
          loading="lazy"
          src={product.image_url}
        />
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col justify-between gap-2 p-4">
        <p className="line-clamp-2 text-sm font-bold leading-5 text-ink">
          {name}
        </p>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-base font-black text-terracotta">
            €{Number(product.price).toFixed(2)}
          </p>
          <p className="text-[11px] font-medium text-stone-400">
            {effectiveStock(product) > 0 ? t.inStock : t.outOfStock}
          </p>
        </div>
      </div>
    </Link>
  );
}
