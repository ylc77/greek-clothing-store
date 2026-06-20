"use client";

import { useMemo, useState } from "react";
import { text, type Language } from "@/lib/i18n";

type ProductActionsProps = {
  productName: string;
  productNameEn: string;
  sku: string;
  sizes: string | null;
  sizeStock?: Record<string, number> | null;
  skroutzUrl?: string | null;
  language?: Language;
  whatsappUrl?: string;
};

interface SizeEntry { label: string; stock: number; }

function parseSizeList(sizes: string | null, sizeStock?: Record<string, number> | null): SizeEntry[] {
  if (sizeStock && typeof sizeStock === "object" && Object.keys(sizeStock).length > 0) {
    return Object.entries(sizeStock).map(([k, v]) => ({ label: k, stock: typeof v === "number" ? v : 0 }));
  }
  // fallback to sizes string (old data)
  return Array.from(new Set((sizes || "").split(/[\/,\s]+/).map(s => s.trim()).filter(Boolean)))
    .map(s => ({ label: s, stock: -1 })); // -1 = unknown stock
}

function buildWhatsAppUrl({ baseUrl, text }: { baseUrl: string; text: string }) {
  const url = new URL(baseUrl);
  const params = new URLSearchParams();
  params.set("text", text);
  url.search = params.toString();
  return url.toString();
}

function buildSkroutzUrl(skroutzUrl: string | null | undefined, productNameEn: string, sku: string) {
  if (skroutzUrl?.trim()) return skroutzUrl.trim();
  const url = new URL("https://www.skroutz.gr/search");
  url.search = new URLSearchParams({ keyphrase: productNameEn.trim() || sku }).toString();
  return url.toString();
}

export function ProductActions({ productName, productNameEn, sku, sizes, sizeStock, skroutzUrl, language, whatsappUrl }: ProductActionsProps) {
  const waUrl = whatsappUrl || "#";
  const t = text[language || "el"];
  const sizeOptions = useMemo(() => parseSizeList(sizes, sizeStock), [sizes, sizeStock]);
  const [selectedSize, setSelectedSize] = useState("");
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [message, setMessage] = useState("");

  const allOut = sizeOptions.length > 0 && sizeOptions.every(s => s.stock === 0);

  function askWhatsApp() {
    if (sizeOptions.length > 1 && !selectedSize) { setMessage(t.selectSize); return; }
    const sizeText = selectedSize || sizeOptions[0]?.label || t.oneSize;
    setMessage("");
    const textContent = [`${t.whatsappAskProduct}: ${productName}`, `${t.whatsappAskSku}: ${sku}`, `${window.location.href}`, sizeText ? `${t.whatsappAskSize}: ${sizeText}` : ""].filter(Boolean).join("\n");
    window.open(buildWhatsAppUrl({ baseUrl: waUrl, text: textContent }), "_blank", "noopener,noreferrer");
  }
  function viewOnSkroutz() { window.open(buildSkroutzUrl(skroutzUrl, productNameEn, sku), "_blank", "noopener,noreferrer"); }
  function checkInStore() {
    const checkText = t.whatsappCheckStore.replace("{name}", productName).replace("{sku}", sku) + "\n" + window.location.href;
    window.open(buildWhatsAppUrl({ baseUrl: waUrl, text: checkText }), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mt-6">
      {sizeOptions.length > 0 ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-black text-ink">{t.sizes}</p>
            <button className="text-sm font-bold text-stone-600 underline underline-offset-4 hover:text-ink" onClick={() => setSizeGuideOpen(c => !c)} type="button">{t.sizeGuide}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => {
              const soldOut = size.stock === 0;
              const selected = selectedSize === size.label;
              return (
                <button
                  key={size.label}
                  className={`min-w-12 relative rounded-full border px-4 py-2 text-sm font-black transition ${
                    soldOut
                      ? "border-stone-100 bg-stone-50 text-stone-300 cursor-not-allowed line-through"
                      : selected
                        ? "border-ink bg-ink text-white"
                        : "border-stone-200 bg-white text-ink hover:border-ink"
                  }`}
                  disabled={soldOut}
                  onClick={() => { if (!soldOut) { setSelectedSize(size.label); setMessage(""); } }}
                  type="button"
                >
                  {size.label}
                  {soldOut ? <span className="ml-1 text-[10px] text-stone-400">—</span> : null}
                </button>
              );
            })}
          </div>
          {allOut ? <p className="mt-3 text-xs font-bold text-red-500">{sizeOptions[0]?.stock !== -1 ? t.outOfStock : ""}</p> : null}
        </div>
      ) : null}

      {sizeGuideOpen ? <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">{t.sizeGuideHelp}</div> : null}
      {message ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{message}</p> : null}

      <button className="mt-5 inline-flex w-full justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-stone-800" onClick={askWhatsApp} type="button">{t.askWhatsApp}</button>
      <button className="mt-3 inline-flex w-full justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-black text-ink transition hover:border-ink" onClick={viewOnSkroutz} type="button">{t.viewSkroutz}</button>
      <button className="mt-3 inline-flex w-full justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-black text-ink transition hover:border-ink" onClick={checkInStore} type="button">{t.checkStore}</button>
    </div>
  );
}
