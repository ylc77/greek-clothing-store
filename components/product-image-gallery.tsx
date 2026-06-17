"use client";

import { useState } from "react";
import { text, type Language } from "@/lib/i18n";

type ProductImageGalleryProps = {
  images: string[];
  alt: string;
  language?: Language;
};

export function ProductImageGallery({ images, alt, language }: ProductImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const hasImages = images.length > 0;
  const hasMultipleImages = images.length > 1;

  function showPrevious() {
    setActiveIndex((current) => (current === 0 ? images.length - 1 : current - 1));
  }

  function showNext() {
    setActiveIndex((current) => (current === images.length - 1 ? 0 : current + 1));
  }

  if (!hasImages) {
    const t = text[(language || "el") as Language];
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-sm text-stone-500">
        {t.noImage}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="relative overflow-hidden rounded-md border border-stone-200 bg-white">
        <img alt={alt} className="aspect-[4/5] w-full object-cover" src={images[activeIndex]} />

        {hasMultipleImages ? (
          <>
            <button
              aria-label="Previous image"
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-2xl font-bold text-ink shadow-sm transition hover:bg-white"
              onClick={showPrevious}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label="Next image"
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-2xl font-bold text-ink shadow-sm transition hover:bg-white"
              onClick={showNext}
              type="button"
            >
              ›
            </button>
            <div className="absolute bottom-3 right-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-bold text-white">
              {activeIndex + 1} / {images.length}
            </div>
          </>
        ) : null}
      </div>

      {hasMultipleImages ? (
        <div className="flex snap-x gap-3 overflow-x-auto pb-1">
          {images.map((imageUrl, index) => (
            <button
              aria-label={`Show image ${index + 1}`}
              className={`h-20 w-16 shrink-0 snap-start overflow-hidden rounded-md border bg-white ${
                activeIndex === index ? "border-ink ring-2 ring-ink/15" : "border-stone-200"
              }`}
              key={`${imageUrl}-${index}`}
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              <img alt={`${alt} ${index + 1}`} className="h-full w-full object-cover" src={imageUrl} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
