"use client";

import { useEffect, useMemo, useState } from "react";
import { text, type Language } from "@/lib/i18n";
import { debugSizeStock, getSizeOptions } from "@/lib/product-stock";

type ProductActionsProps = {
  productName: string;
  productNameEn: string;
  sku: string;
  sizes: string | null;
  sizeStock?: Record<string, number> | null;
  stock: number;
  skroutzUrl?: string | null;
  language?: Language;
  whatsappUrl?: string;
  category?: string;
  subcategory?: string;
  price?: number;
  imageUrl?: string;
  sizeChart?: Record<string, unknown> | null;
  fitType?: string;
};

function buildWhatsAppUrl({ baseUrl, text }: { baseUrl: string; text: string }) {
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({ text }).toString();
  return url.toString();
}

function buildSkroutzUrl(skroutzUrl: string | null | undefined, productNameEn: string, sku: string) {
  if (skroutzUrl?.trim()) return skroutzUrl.trim();
  const url = new URL("https://www.skroutz.gr/search");
  url.search = new URLSearchParams({ keyphrase: productNameEn.trim() || sku }).toString();
  return url.toString();
}

export function ProductActions({ productName, productNameEn, sku, sizes, sizeStock, stock, skroutzUrl, language, whatsappUrl, category, subcategory, price, imageUrl, sizeChart, fitType }: ProductActionsProps) {
  const waUrl = whatsappUrl || "#";
  const t = text[language || "el"];
  const sizeOptions = useMemo(() => { debugSizeStock("ProductActions", sizeStock, sizes); return getSizeOptions({ sizes, stock, size_stock: sizeStock }); }, [sizes, stock, sizeStock]);
  const [selectedSize, setSelectedSize] = useState("");
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [message, setMessage] = useState("");

  const allOut = sizeOptions.length > 0 && sizeOptions.every(s => s.disabled);
  const hasSkroutz = Boolean(skroutzUrl?.trim());
  const hasWhatsApp = Boolean(whatsappUrl?.trim());

  // Auto-clear selected size if it becomes disabled
  useEffect(() => {
    if (selectedSize) {
      const entry = sizeOptions.find(s => s.label === selectedSize);
      if (!entry || entry.disabled) setSelectedSize("");
    }
  }, [sizeOptions, selectedSize]);

  function askWhatsApp() {
    if (sizeOptions.length > 1 && !selectedSize) { setMessage(t.selectSize); return; }
    setMessage("");
    const sizeText = selectedSize || (sizeOptions.find(s => !s.disabled)?.label) || t.oneSize;
    const textContent = [`${t.whatsappAskProduct}: ${productName}`, `${t.whatsappAskSku}: ${sku}`, `${window.location.href}`, sizeText ? `${t.whatsappAskSize}: ${sizeText}` : ""].filter(Boolean).join("\n");
    window.open(buildWhatsAppUrl({ baseUrl: waUrl, text: textContent }), "_blank", "noopener,noreferrer");
  }
  function viewOnSkroutz() { window.open(buildSkroutzUrl(skroutzUrl, productNameEn, sku), "_blank", "noopener,noreferrer"); }

  return (
    <div>
      {/* Size selector */}
      {sizeOptions.length > 0 ? (
        <div className="mb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">{t.sizes}</p>
            <button className="text-xs font-bold text-stone-400 underline underline-offset-4 hover:text-ink" onClick={() => setSizeGuideOpen(c => !c)} type="button">{t.sizeGuide}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => {
              const selected = !size.disabled && selectedSize === size.label;
              return (
                <button
                  key={size.label}
                  className={`relative min-w-[44px] rounded-full border px-4 py-2.5 text-sm font-bold transition ${
                    size.disabled
                      ? "border-stone-100 bg-stone-50 text-stone-300 cursor-not-allowed opacity-60"
                      : selected
                        ? "border-ink bg-ink text-white shadow-sm"
                        : "border-stone-200 bg-white text-ink hover:border-ink hover:shadow-sm"
                  }`}
                  disabled={size.disabled}
                  onClick={() => {
                    if (size.disabled) return;
                    setSelectedSize(size.label);
                    setMessage("");
                  }}
                  type="button"
                >
                  {size.label}
                  {size.disabled ? <span className="ml-1 text-[10px] text-stone-300">×</span> : null}
                </button>
              );
            })}
          </div>
          {allOut ? <p className="mt-3 text-xs font-bold text-red-500">{t.outOfStockLabel}</p> : null}
        </div>
      ) : null}

      {sizeGuideOpen ? <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">{t.sizeGuideHelp}</div> : null}
      {message ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{message}</p> : null}

      {/* BUTTONS: Skroutz, AI Assistant, WhatsApp */}
      {hasSkroutz ? (
        allOut ? (
          <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-stone-200 px-6 py-3.5 text-sm font-black text-stone-400 cursor-not-allowed" disabled type="button">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>
            {t.viewSkroutz} ({t.outOfStockLabel})
          </button>
        ) : (
          <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#2d7d46] px-6 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#236836] hover:shadow-md hover:-translate-y-0.5" onClick={viewOnSkroutz} type="button">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>
            {t.viewSkroutz}
            <svg className="h-3.5 w-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M7 7h10v10" /></svg>
          </button>
        )
      ) : null}

      {/* AI Assistant button */}
      <button className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-6 py-3 text-sm font-bold text-violet-700 transition hover:bg-violet-100 hover:border-violet-300" onClick={() => { window.dispatchEvent(new CustomEvent("openAiChat", { detail: { product: { sku, productName, productNameEn, sizes, sizeStock, stock, category, subcategory, price, imageUrl, sizeChart, fitType } } })); }} type="button">{t.askAi}</button>

      {hasWhatsApp ? (
        <button className={`mt-2 inline-flex w-full items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-bold text-ink transition hover:border-ink hover:bg-stone-50 ${!hasSkroutz ? "py-3.5 shadow-sm" : ""}`} onClick={askWhatsApp} type="button">{t.whatsappContact}</button>
      ) : null}
    </div>
  );
}
