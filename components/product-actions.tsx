"use client";

import { useMemo, useState } from "react";
import { text, type Language } from "@/lib/i18n";
import { whatsappUrl } from "@/lib/site";

type ProductActionsProps = {
  productName: string;
  productNameEn: string;
  sku: string;
  sizes: string | null;
  skroutzUrl?: string | null;
  language?: Language;
};

function parseSizes(sizes: string | null) {
  return Array.from(
    new Set(
      (sizes || "")
        .split(/[\/,\s]+/)
        .map((size) => size.trim())
        .filter(Boolean)
    )
  );
}

function buildWhatsAppUrl({
  productName,
  selectedSize,
  sku
}: {
  productName: string;
  selectedSize: string;
  sku: string;
}) {
  const url = new URL(whatsappUrl);
  const params = new URLSearchParams();
  params.set(
    "text",
    [
      `Product: ${productName}`,
      `SKU: ${sku}`,
      `Link: ${window.location.href}`,
      selectedSize ? `Size: ${selectedSize}` : ""
    ].filter(Boolean).join("\n")
  );
  url.search = params.toString();
  return url.toString();
}

function buildSkroutzUrl(skroutzUrl: string | null | undefined, productNameEn: string, sku: string) {
  if (skroutzUrl?.trim()) {
    return skroutzUrl.trim();
  }

  const url = new URL("https://www.skroutz.gr/search");
  const params = new URLSearchParams();
  params.set("keyphrase", productNameEn.trim() || sku);
  url.search = params.toString();
  return url.toString();
}

export function ProductActions({ productName, productNameEn, sku, sizes, skroutzUrl, language }: ProductActionsProps) {
  const t = text[language || "el"];
  const sizeOptions = useMemo(() => parseSizes(sizes), [sizes]);
  const [selectedSize, setSelectedSize] = useState(sizeOptions.length === 1 ? sizeOptions[0] : "");
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [message, setMessage] = useState("");

  function askWhatsApp() {
    if (sizeOptions.length > 1 && !selectedSize) {
      setMessage("Please select a size first.");
      return;
    }

    const sizeForMessage = selectedSize || sizeOptions[0] || "One size";
    setMessage("");
    window.open(
      buildWhatsAppUrl({
        productName,
        selectedSize: sizeForMessage,
        sku
      }),
      "_blank",
      "noopener,noreferrer"
    );
  }

  function viewOnSkroutz() {
    window.open(buildSkroutzUrl(skroutzUrl, productNameEn, sku), "_blank", "noopener,noreferrer");
  }

  function checkInStore() {
    const url = new URL(whatsappUrl);
    const params = new URLSearchParams();
    params.set(
      "text",
      `Is "${productName}" (SKU: ${sku}) available in your store?\n${window.location.href}`
    );
    url.search = params.toString();
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mt-6">
      {sizeOptions.length > 0 ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-black text-ink">{t.sizes}</p>
            <button
              className="text-sm font-bold text-stone-600 underline underline-offset-4 hover:text-ink"
              onClick={() => setSizeGuideOpen((current) => !current)}
              type="button"
            >
              Size guide
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => (
              <button
                className={`min-w-12 rounded-full border px-4 py-2 text-sm font-black transition ${
                  selectedSize === size
                    ? "border-ink bg-ink text-white"
                    : "border-stone-200 bg-white text-ink hover:border-ink"
                }`}
                key={size}
                onClick={() => {
                  setSelectedSize(size);
                  setMessage("");
                }}
                type="button"
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {sizeGuideOpen ? (
        <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
          Not sure about your size? Send us your height, weight and usual size. We will help you choose.
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          {message}
        </p>
      ) : null}

      <button
        className="mt-5 inline-flex w-full justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-stone-800"
        onClick={askWhatsApp}
        type="button"
      >
        {t.askWhatsApp}
      </button>

      <button
        className="mt-3 inline-flex w-full justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-black text-ink transition hover:border-ink"
        onClick={viewOnSkroutz}
        type="button"
      >
        {t.viewSkroutz}
      </button>

      <button
        className="mt-3 inline-flex w-full justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-black text-ink transition hover:border-ink"
        onClick={checkInStore}
        type="button"
      >
        {t.checkStore}
      </button>
    </div>
  );
}
