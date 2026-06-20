"use client";

import { useState } from "react";

type SafeImageProps = {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fallback?: React.ReactNode;
};

/** Renders an img with onError fallback. If src is empty, shows a refined placeholder. */
export function SafeImage({ src, alt, className, loading, fallback }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
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

  return (
    <img
      alt={alt}
      className={className}
      loading={loading}
      src={src}
      onError={() => setFailed(true)}
    />
  );
}
