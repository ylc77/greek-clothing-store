"use client";

import { useState } from "react";

export function LogoImg({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img
      alt={alt}
      className="h-9 max-w-[120px] w-auto rounded object-contain"
      src={src}
      onError={() => setOk(false)}
    />
  );
}
