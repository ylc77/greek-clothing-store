"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart-provider";
import { text, type Language } from "@/lib/i18n";
import { getSizeOptions } from "@/lib/product-stock";
import type { SizeSystem } from "@/lib/types";
import { publicVariantOptions, sizeOptionsForColor, type PublicProductVariant } from "@/lib/product-variant-matrix";

type ProductActionsProps = {
  productName: string;
  productNameEn: string;
  productNameGr?: string;
  sku: string;
  sizes: string | null;
  sizeSystem?: SizeSystem | null;
  sizeStock?: Record<string, number> | null;
  variants?: PublicProductVariant[];
  stock: number;
  onlineStoreEnabled?: boolean;
  aiEnabled?: boolean;
  language?: Language;
  whatsappUrl?: string;
  category?: string;
  subcategory?: string;
  price?: number;
  imageUrl?: string;
  sizeChart?: Record<string, unknown> | null;
  fitType?: string;
};

function buildWhatsAppUrl(baseUrl: string, message: string) {
  try {
    const url = new URL(baseUrl);
    url.search = new URLSearchParams({ text: message }).toString();
    return url.toString();
  } catch { return "#"; }
}

export function ProductActions({ productName, productNameEn, productNameGr, sku, sizes, sizeSystem, sizeStock, variants, stock, onlineStoreEnabled = false, aiEnabled = true, language = "el", whatsappUrl, category, subcategory, price = 0, imageUrl, sizeChart, fitType }: ProductActionsProps) {
  const router = useRouter();
  const { addItem } = useCart();
  const t = text[language];
  const normalizedVariants = useMemo(() => publicVariantOptions(variants), [variants]);
  const colors = useMemo(() => Array.from(new Set(normalizedVariants.map(item => item.color).filter(Boolean))), [normalizedVariants]);
  const [selectedColor, setSelectedColor] = useState("");
  const activeColor = colors.some(color => color.toLocaleLowerCase() === selectedColor.toLocaleLowerCase()) ? selectedColor : colors[0] || "";
  const sizeOptions = useMemo(() => normalizedVariants.length > 0 ? sizeOptionsForColor(normalizedVariants, activeColor) : getSizeOptions({ sizes, stock, size_stock: sizeStock }), [activeColor, normalizedVariants, sizeStock, sizes, stock]);
  const availableSizes = sizeOptions.filter(option => !option.disabled);
  const [selectedSize, setSelectedSize] = useState("");
  const resolvedSize = selectedSize || (availableSizes.length === 1 ? availableSizes[0].label : "");
  const selectedVariant = normalizedVariants.find(variant => variant.size === resolvedSize && variant.color.toLocaleLowerCase() === activeColor.toLocaleLowerCase());
  const selectedOption = sizeOptions.find(option => option.label === resolvedSize) as { quantity?: number; stock?: number } | undefined;
  const selectedAvailable = selectedVariant?.quantityAvailable
    ?? selectedOption?.quantity
    ?? (selectedOption?.stock === -1 ? Number(stock) : selectedOption?.stock)
    ?? 0;
  const selectedUnitPrice = selectedVariant?.unitPrice ?? Number(price);
  const [quantity, setQuantity] = useState(1);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const outOfStock = Number(stock) <= 0 || availableSizes.length === 0;
  const selectionReady = !outOfStock && Boolean(resolvedSize) && selectedAvailable > 0;
  const hasWhatsApp = Boolean(whatsappUrl?.trim());
  const colorLabel = language === "en" ? "Color" : "Χρώμα";
  const quantityLabel = language === "en" ? "Quantity" : "Ποσότητα";
  const addLabel = language === "en" ? "Add to cart" : "Προσθήκη στο καλάθι";
  const buyLabel = language === "en" ? "Buy now" : "Αγορά τώρα";

  useEffect(() => { setCurrentUrl(window.location.href); }, []);
  useEffect(() => {
    if (selectedSize && !sizeOptions.some(option => option.label === selectedSize && !option.disabled)) setSelectedSize("");
    setQuantity(1);
  }, [activeColor, selectedSize, sizeOptions]);

  function validateSelection() {
    if (!onlineStoreEnabled) { setMessage(language === "en" ? "Online ordering is not available yet." : "Οι online παραγγελίες δεν είναι ακόμη διαθέσιμες."); return false; }
    if (!selectionReady) { setMessage(t.selectSize); return false; }
    setMessage("");
    return true;
  }

  function addToCart(goToCheckout = false) {
    if (!validateSelection()) return;
    addItem({
      productSku: sku,
      nameEn: productNameEn || productName,
      nameGr: productNameGr || productName,
      size: resolvedSize,
      color: activeColor,
      quantity,
      availableQuantity: selectedAvailable,
      unitPrice: selectedUnitPrice,
      imageUrl: imageUrl || "",
    });
    setMessage(language === "en" ? "Added to cart." : "Προστέθηκε στο καλάθι.");
    if (goToCheckout) router.push(language === "en" ? "/checkout?lang=en" : "/checkout");
  }

  const whatsappMessage = [
    `${t.whatsappAskProduct}: ${productName}`,
    `${t.whatsappAskSku}: ${sku}`,
    currentUrl,
    colors.length > 1 ? `${colorLabel}: ${activeColor}` : "",
    resolvedSize ? `${t.whatsappAskSize}: ${resolvedSize}` : "",
  ].filter(Boolean).join("\n");

  return (
    <div>
      {colors.length > 1 ? <div className="mb-5"><p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-500">{colorLabel}</p><div className="flex flex-wrap gap-2">{colors.map(color => {
        const selected = color.toLocaleLowerCase() === activeColor.toLocaleLowerCase();
        const hasStock = normalizedVariants.some(variant => variant.color.toLocaleLowerCase() === color.toLocaleLowerCase() && variant.quantityAvailable > 0);
        return <button className={`min-h-11 rounded-full border px-4 py-2.5 text-sm font-bold transition ${selected ? "border-ink bg-ink text-white" : "border-stone-200 bg-white hover:border-ink"}`} key={color} onClick={() => { setSelectedColor(color); setSelectedSize(""); setMessage(""); }} type="button">{color}{!hasStock ? <span className="ml-1 opacity-50">×</span> : null}</button>;
      })}</div></div> : null}

      {sizeOptions.length > 0 ? <div className="mb-5"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">{t.sizes}</p><button className="min-h-9 text-xs font-bold text-stone-500 underline underline-offset-4" onClick={() => setSizeGuideOpen(value => !value)} type="button">{t.sizeGuide}</button></div><div className="flex flex-wrap gap-2">{sizeOptions.map(option => <button className={`relative min-h-11 min-w-12 rounded-full border px-4 py-2.5 text-sm font-bold ${option.disabled ? "cursor-not-allowed border-stone-100 bg-stone-50 text-stone-300" : resolvedSize === option.label ? "border-ink bg-ink text-white" : "border-stone-200 bg-white hover:border-ink"}`} disabled={option.disabled} key={option.label} onClick={() => { setSelectedSize(option.label); setMessage(""); }} type="button">{option.label}{option.disabled ? <span className="ml-1">×</span> : null}</button>)}</div>{outOfStock ? <p className="mt-3 text-xs font-bold text-red-500">{t.outOfStockLabel}</p> : null}</div> : null}

      {sizeGuideOpen ? <div className="mb-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">{t.sizeGuideHelp}</div> : null}

      {selectionReady ? <div className="mb-5 flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"><span className="text-sm font-bold text-stone-600">{quantityLabel}</span><div className="flex items-center gap-3"><button aria-label="Decrease quantity" className="h-10 w-10 rounded-full border border-stone-300 bg-white text-lg" disabled={quantity <= 1} onClick={() => setQuantity(value => Math.max(1, value - 1))} type="button">−</button><span className="min-w-6 text-center font-black">{quantity}</span><button aria-label="Increase quantity" className="h-10 w-10 rounded-full border border-stone-300 bg-white text-lg" disabled={quantity >= Math.min(selectedAvailable, 20)} onClick={() => setQuantity(value => Math.min(value + 1, selectedAvailable, 20))} type="button">+</button></div></div> : null}
      {message ? <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <button className="inline-flex min-h-13 items-center justify-center rounded-full bg-terracotta px-6 py-3.5 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400" disabled={!onlineStoreEnabled || outOfStock} onClick={() => addToCart(false)} type="button">{addLabel}</button>
        <button className="inline-flex min-h-13 items-center justify-center rounded-full bg-ink px-6 py-3.5 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400" disabled={!onlineStoreEnabled || outOfStock} onClick={() => addToCart(true)} type="button">{buyLabel}</button>
      </div>

      {aiEnabled ? <button className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-6 py-3 text-sm font-bold text-violet-700 hover:bg-violet-100" onClick={() => window.dispatchEvent(new CustomEvent("openAiChat", { detail: { product: { sku, productName, productNameEn, productNameGr, sizes, sizeSystem, sizeStock, variants: normalizedVariants, selectedColor: activeColor, stock, category, subcategory, price, imageUrl, sizeChart, fitType } } }))} type="button">{t.askAi}</button> : null}
      {hasWhatsApp ? <a className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-bold text-ink" href={buildWhatsAppUrl(whatsappUrl!, whatsappMessage)} rel="noreferrer" target="_blank">{t.whatsappContact}</a> : null}
    </div>
  );
}
