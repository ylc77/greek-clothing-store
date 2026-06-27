"use client";

import { useState } from "react";
import { SafeImage } from "@/components/safe-image";

export function LogoImg({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <SafeImage
      alt={alt}
      className="h-9 max-w-[120px] w-auto rounded object-contain"
      loading="eager"
      sizes="120px"
      src={src}
      onError={() => setOk(false)}
    />
  );
}
