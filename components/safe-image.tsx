"use client";

import { useState, type ReactNode } from "react";

type SafeImageProps = {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  decoding?: "sync" | "async" | "auto";
  fallback?: ReactNode;
  /** Secondary image URL to try if primary src fails (e.g. JPG → SVG fallback). */
  fallbackSrc?: string;
};

/** Renders an img with onError fallback. If src is empty, shows a refined placeholder. */
export function SafeImage({
  src,
  alt,
  className,
  loading,
  fetchPriority,
  decoding = "async",
  fallback,
  fallbackSrc,
}: SafeImageProps) {
  const [failStage, setFailStage] = useState(0);
  // 0 = trying primary src; 1 = trying fallbackSrc; 2 = show placeholder

  const effectiveSrc = failStage === 1 && fallbackSrc ? fallbackSrc : src;
  const failed = failStage >= 2 || !effectiveSrc;

  if (failed) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#f3efe8]">
        <svg
          className="h-12 w-12 text-stone-300"
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
    );
  }

  function handleError() {
    if (failStage === 0 && fallbackSrc) {
      setFailStage(1); // try fallbackSrc next
    } else {
      setFailStage(2); // both failed → show placeholder
    }
  }

  return (
    <img
      alt={alt}
      className={className}
      decoding={decoding}
      fetchPriority={fetchPriority}
      loading={loading}
      src={effectiveSrc}
      onError={handleError}
    />
  );
}
