"use client";

import { useEffect, useMemo, useState } from "react";
import { text, type Language } from "@/lib/i18n";
import { getSizeOptions } from "@/lib/product-stock";

type ProductActionsProps = {
  productName: string;
  productNameEn: string;
  productNameGr?: string;
  sku: string;
  sizes: string | null;
  sizeStock?: Record<string, number> | null;
  stock: number;
  skroutzUrl?: string | null;
  skroutzEnabled?: boolean;
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
  try {
    const url = new URL(baseUrl);
    url.search = new URLSearchParams({ text }).toString();
    return url.toString();
  } catch { return "#"; }
}

function buildSkroutzUrl(skroutzUrl: string | null | undefined, productNameEn: string, sku: string) {
  if (skroutzUrl?.trim()) return skroutzUrl.trim();
  const url = new URL("https://www.skroutz.gr/search");
  url.search = new URLSearchParams({ keyphrase: productNameEn.trim() || sku }).toString();
  return url.toString();
}

export function ProductActions({ productName, productNameEn, productNameGr, sku, sizes, sizeStock, stock, skroutzUrl, skroutzEnabled = true, language, whatsappUrl, category, subcategory, price, imageUrl, sizeChart, fitType }: ProductActionsProps) {
  const waUrl = whatsappUrl || "#";
  const t = text[language || "el"];
  const sizeOptions = useMemo(() => getSizeOptions({ sizes, stock, size_stock: sizeStock }), [sizes, stock, sizeStock]);
  const [selectedSize, setSelectedSize] = useState("");
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");

  const totalStock = Number(stock) || 0;
  const allOut = sizeOptions.length > 0 && sizeOptions.every(s => s.disabled);
  const outOfStock = totalStock <= 0 || allOut;
  const hasWhatsApp = Boolean(whatsappUrl?.trim());
  const skroutzHref = buildSkroutzUrl(skroutzUrl, productNameEn, sku);
  const selectedSizeText = selectedSize || (sizeOptions.find(s => !s.disabled)?.label) || t.oneSize;
  const whatsappMessage = [`${t.whatsappAskProduct}: ${productName}`, `${t.whatsappAskSku}: ${sku}`, currentUrl, selectedSizeText ? `${t.whatsappAskSize}: ${selectedSizeText}` : ""].filter(Boolean).join("\n");
  const whatsappHref = hasWhatsApp ? buildWhatsAppUrl({ baseUrl: waUrl, text: whatsappMessage }) : "#";

  useEffect(() => {
    setCurrentUrl(window.location.href);
  }, []);

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
  }

  return (
    <div>
      {/* Size selector */}
      {sizeOptions.length > 0 ? (
        <div className="mb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">{t.sizes}</p>
            <button className="inline-flex min-h-9 items-center rounded-full px-2 text-xs font-bold text-stone-500 underline underline-offset-4 hover:bg-stone-100 hover:text-ink" onClick={() => setSizeGuideOpen(c => !c)} type="button">{t.sizeGuide}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => {
              const selected = !size.disabled && selectedSize === size.label;
              return (
                <button
                  key={size.label}
                  className={`relative min-h-11 min-w-[48px] rounded-full border px-4 py-2.5 text-sm font-bold transition ${
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
          {outOfStock ? <p className="mt-3 text-xs font-bold text-red-500">{t.outOfStockLabel}</p> : null}
        </div>
      ) : null}

      {sizeGuideOpen ? <div className="mb-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">{t.sizeGuideHelp}</div> : null}
      {message ? <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{message}</p> : null}

      {/* BUTTONS: Skroutz, AI Assistant, WhatsApp */}
      {skroutzEnabled ? outOfStock ? (
        <button className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-stone-200 px-6 py-3.5 text-sm font-black text-stone-400 cursor-not-allowed" disabled type="button">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>
          {t.viewSkroutz} ({t.outOfStockLabel})
        </button>
      ) : (
        <a className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#2d7d46] px-6 py-3.5 text-sm font-black text-white shadow-sm shadow-green-900/10 transition hover:-translate-y-0.5 hover:bg-[#236836] hover:shadow-md" href={skroutzHref} rel="noreferrer" target="_blank">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>
          {t.viewSkroutz}
          <svg className="h-3.5 w-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M7 7h10v10" /></svg>
        </a>
      ) : null}

      {/* AI Assistant button */}
      <button className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-6 py-3 text-sm font-bold text-violet-700 transition hover:bg-violet-100 hover:border-violet-300" onClick={() => { window.dispatchEvent(new CustomEvent("openAiChat", { detail: { product: { sku, productName, productNameEn, productNameGr, sizes, sizeStock, stock, category, subcategory, price, imageUrl, sizeChart, fitType } } })); }} type="button">{t.askAi}</button>

      {hasWhatsApp ? (
        <a
          className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-bold text-ink transition hover:border-ink hover:bg-stone-50"
          href={whatsappHref}
          onClick={(event) => {
            if (sizeOptions.length > 1 && !selectedSize) {
              event.preventDefault();
              askWhatsApp();
            } else {
              setMessage("");
            }
          }}
          rel="noreferrer"
          target="_blank"
        >
          {t.whatsappContact}
        </a>
      ) : null}
    </div>
  );
}
