"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { text, type Language } from "@/lib/i18n";
import type { Product } from "@/lib/types";

const AUTO_ADVANCE_MS = 4200;
const CARD_GAP_PX = 16;

export function RelatedProductsCarousel({
  products,
  language,
}: {
  products: Product[];
  language: Language;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pointerActive, setPointerActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const t = text[language];
  const isEnglish = language === "en";
  const paused = focusedWithin || hovered || pointerActive;

  const move = useCallback((direction: -1 | 1) => {
    const rail = railRef.current;
    const firstCard = rail?.querySelector<HTMLElement>("[data-related-product]");
    if (!rail || !firstCard) return;

    const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth);
    if (maximum <= 1) return;

    const step = firstCard.getBoundingClientRect().width + CARD_GAP_PX;
    const atStart = rail.scrollLeft <= 8;
    const atEnd = rail.scrollLeft >= maximum - 8;
    const target = direction === 1
      ? atEnd ? 0 : Math.min(maximum, rail.scrollLeft + step)
      : atStart ? maximum : Math.max(0, rail.scrollLeft - step);

    rail.scrollTo({ left: target, behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || products.length < 2) return;
    const interval = window.setInterval(() => move(1), AUTO_ADVANCE_MS);
    return () => window.clearInterval(interval);
  }, [move, paused, products.length, reducedMotion]);

  if (products.length === 0) return null;

  return (
    <section
      aria-labelledby="related-products-heading"
      aria-roledescription={isEnglish ? "carousel" : "καρουζέλ"}
      className="mx-auto max-w-[90rem] px-4 pb-12 pt-7 sm:px-6 sm:pb-16 sm:pt-10 lg:px-8"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedWithin(false);
      }}
      onFocusCapture={() => setFocusedWithin(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerCancel={() => setPointerActive(false)}
      onPointerDown={() => setPointerActive(true)}
      onPointerUp={() => setPointerActive(false)}
    >
      <div className="mb-5 flex items-end justify-between gap-4 border-t border-stone-200/80 pt-8 sm:mb-6 sm:pt-10">
        <div>
          <p className="ui-kicker">{isEnglish ? "You may also like" : "Μπορεί επίσης να σας αρέσουν"}</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl" id="related-products-heading">
            {t.relatedProducts}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500 sm:text-base">
            {t.relatedProductsText}
          </p>
        </div>

        {products.length > 1 ? (
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              aria-label={isEnglish ? "Previous related products" : "Προηγούμενα σχετικά προϊόντα"}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-xl font-black text-ink shadow-sm hover:border-ink hover:bg-stone-50"
              onClick={() => move(-1)}
              type="button"
            >
              ←
            </button>
            <button
              aria-label={isEnglish ? "Next related products" : "Επόμενα σχετικά προϊόντα"}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-xl font-black text-white shadow-sm hover:bg-stone-800"
              onClick={() => move(1)}
              type="button"
            >
              →
            </button>
          </div>
        ) : null}
      </div>

      <div
        aria-live="off"
        className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3"
        ref={railRef}
      >
        {products.map((product) => (
          <div
            className="w-[72vw] max-w-[18rem] shrink-0 snap-start sm:w-[42vw] md:w-[31vw] lg:w-[calc((100%_-_4rem)/5)] lg:max-w-none"
            data-related-product
            key={product.sku}
          >
            <ProductCard language={language} product={product} />
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs font-bold text-stone-400 sm:hidden">
        {isEnglish ? "Swipe to browse more" : "Σύρετε για περισσότερα"}
      </p>
    </section>
  );
}
