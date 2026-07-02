"use client";

import Image from "next/image";
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
      <div className="flex min-h-[340px] items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-[#f5f1ea] text-sm font-bold text-stone-500 md:min-h-[680px]">
        {t.noImage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:gap-4">
      {hasMultipleImages ? (
        <div className="scrollbar-none order-2 flex snap-x gap-2 overflow-x-auto pb-1 pr-6 md:order-1 md:max-h-[680px] md:w-20 md:shrink-0 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pb-0 md:pr-0">
          {images.map((imageUrl, index) => (
            <button
              aria-label={`Show image ${index + 1}`}
              className={`h-24 w-20 shrink-0 snap-start overflow-hidden rounded-xl border bg-white shadow-sm transition md:h-24 md:w-20 ${
                activeIndex === index ? "border-ink ring-2 ring-ink/15" : "border-stone-200 hover:border-stone-400"
              }`}
              key={`${imageUrl}-${index}`}
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              <Image
                alt={`${alt} ${index + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
                sizes="80px"
                src={imageUrl}
                width={80}
                height={96}
                unoptimized={isSvg(imageUrl)}
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative order-1 min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-stone-200 bg-[#f5f1ea] shadow-sm shadow-stone-900/5 md:order-2 md:min-h-[680px]">
        <Image
          alt={alt}
          className="object-contain object-center"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          src={images[activeIndex]}
          unoptimized={isSvg(images[activeIndex])}
        />

        {hasMultipleImages ? (
          <>
            <GalleryButton label="Previous image" onClick={showPrevious} side="left" />
            <GalleryButton label="Next image" onClick={showNext} side="right" />
            <div className="absolute bottom-3 right-3 rounded-full bg-ink/85 px-3 py-1 text-xs font-black text-white shadow-sm">
              {activeIndex + 1} / {images.length}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function isSvg(src: string) {
  return /\.svg($|\?)/i.test(src);
}

function GalleryButton({
  label,
  onClick,
  side,
}: {
  label: string;
  onClick: () => void;
  side: "left" | "right";
}) {
  return (
    <button
      aria-label={label}
      className={`absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-lg shadow-stone-900/10 backdrop-blur transition hover:bg-white ${
        side === "left" ? "left-3" : "right-3"
      }`}
      onClick={onClick}
      type="button"
    >
      <svg aria-hidden="true" className={`h-5 w-5 ${side === "left" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
