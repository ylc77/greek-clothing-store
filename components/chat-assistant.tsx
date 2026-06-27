"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { text, type Language } from "@/lib/i18n";

type Message = { role: "user" | "assistant"; text: string; products?: AiProduct[] };
type AiProduct = {
  sku: string;
  name_en: string;
  name_gr: string;
  price: number;
  stock: number;
  sizes: string;
  image_url: string;
  reason: string;
  url: string;
};

function shouldShowProductRecommendations(message: string) {
  const normalized = message.toLowerCase();
  return [
    "similar",
    "recommend",
    "other product",
    "παρόμοια",
    "πρότεινε",
    "προϊόντα",
    "άλλα",
  ].some((term) => normalized.includes(term));
}

export function ChatAssistant({
  language,
  productContext,
  onClose,
}: {
  language: Language;
  productContext?: Record<string, unknown> | null;
  onClose?: () => void;
}) {
  const t = text[language];
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: t.aiGreeting }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousLanguageRef = useRef(language);
  const [expanded, setExpanded] = useState(() => {
    try {
      return !!productContext || localStorage.getItem("ai_chat_size") === "expanded";
    } catch {
      return !!productContext;
    }
  });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const previousLanguage = previousLanguageRef.current;
    if (previousLanguage === language) return;

    const oldGreeting = text[previousLanguage].aiGreeting;
    setMessages((prev) => {
      if (prev.length === 0) {
        return [{ role: "assistant", text: t.aiGreeting }];
      }

      if (prev.length === 1 && prev[0].role === "assistant" && prev[0].text === oldGreeting) {
        return [{ role: "assistant", text: t.aiGreeting }];
      }

      return prev;
    });
    previousLanguageRef.current = language;
  }, [language, t.aiGreeting]);

  async function sendMessage(msg?: string) {
    const text = msg || input.trim();
    if (!text || loading) return;
    if (!msg) setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const body: Record<string, unknown> = { message: text, language };
      if (productContext) body.productContext = productContext;

      const response = await fetch("/api/ai-shop-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      const currentSku = productContext?.sku ? String(productContext.sku) : "";
      const products = Array.isArray(data.products) ? data.products : [];
      const visibleProducts = shouldShowProductRecommendations(text)
        ? products.filter((product: AiProduct) => product.sku !== currentSku)
        : [];

      setMessages((prev) => [...prev, { role: "assistant", text: data.reply || "", products: visibleProducts }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: language === "el"
            ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος."
            : "AI assistant is temporarily unavailable.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function productName(product: AiProduct) {
    return language === "el" ? product.name_gr || product.name_en : product.name_en || product.name_gr;
  }

  function toggleExpand() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ai_chat_size", next ? "expanded" : "compact");
      } catch {}
      return next;
    });
  }

  function clearChat() {
    setMessages([{ role: "assistant", text: t.aiGreeting }]);
  }

  const quickBtns = productContext
    ? [
        { label: t.aiSizeBtn, prompt: t.aiSizePrompt },
        { label: t.aiSimilarBtn, prompt: t.aiSimilarPrompt },
        { label: t.aiSummerBtn, prompt: t.aiSummerPrompt },
        { label: t.aiMaterialBtn, prompt: t.aiMaterialPrompt },
      ]
    : [];

  const isWide = expanded && !isMobile;
  const winW = isWide ? "max-w-[640px]" : "max-w-[440px]";
  const winH = isWide ? "sm:h-[760px]" : "sm:h-[620px]";

  const productPrice = Number(productContext?.price || 0).toFixed(2);
  const productSizes = String(productContext?.sizes || "—");
  const productStockLabel = Number(productContext?.stock || 0) > 0
    ? language === "el" ? "Σε απόθεμα" : "In stock"
    : language === "el" ? "Εκτός αποθέματος" : "Out of stock";

  return (
    <div className={`fixed bottom-2 right-3 z-50 flex h-[calc(100dvh-80px)] max-h-[calc(100dvh-80px)] w-[calc(100vw-24px)] ${winW} ${winH} flex-col rounded-2xl border border-stone-200 bg-white shadow-2xl sm:bottom-6 sm:right-6 sm:max-h-[calc(100vh-48px)]`}>
      <div className="flex shrink-0 items-center justify-between rounded-t-2xl bg-ink px-4 py-3 text-white">
        <span className="text-sm font-black">{t.aiAssistant}</span>
        <div className="flex items-center gap-1">
          {!isMobile ? (
            <button className="px-1 text-white/60 hover:text-white" onClick={toggleExpand} type="button" title={expanded ? "Shrink" : "Expand"}>
              {expanded ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" /><line x1="9" y1="4" x2="9" y2="2" /><line x1="15" y1="4" x2="15" y2="2" /><line x1="9" y1="20" x2="9" y2="22" /><line x1="15" y1="20" x2="15" y2="22" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              )}
            </button>
          ) : null}
          <button className="text-white/70 hover:text-white" onClick={onClose} type="button">×</button>
        </div>
      </div>

      {productContext ? (
        <div className="mx-3 mt-2 flex shrink-0 gap-2 rounded-xl border border-violet-100 bg-violet-50/50 p-2 sm:mx-4 sm:mt-3 sm:gap-3 sm:p-3">
          {productContext.imageUrl ? <img alt="" className="h-12 w-9 rounded-lg object-cover sm:h-16 sm:w-12" src={String(productContext.imageUrl)} /> : null}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase text-violet-600 sm:text-[10px]">{t.aiProductLabel}</p>
            <p className="mt-0.5 line-clamp-1 text-[11px] font-bold text-ink sm:text-xs">
              {language === "en"
                ? String(productContext.productNameEn || productContext.productName || "")
                : String(productContext.productNameGr || productContext.productName || productContext.productNameEn || "")}
            </p>
            <p className="mt-0.5 line-clamp-1 text-[10px] text-stone-500 sm:text-[11px]">
              €{productPrice} · {productSizes} · {productStockLabel}
            </p>
          </div>
        </div>
      ) : null}

      {quickBtns.length > 0 ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-1 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:px-4 [&::-webkit-scrollbar]:hidden">
          {quickBtns.map((q, i) => (
            <button key={i} className="shrink-0 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100 sm:py-1" onClick={() => sendMessage(q.prompt)} type="button">
              {q.label}
            </button>
          ))}
        </div>
      ) : null}

      {messages.length > 1 ? (
        <div className="shrink-0 px-4 pt-1 text-right">
          <button className="text-[10px] text-stone-400 underline hover:text-ink" onClick={clearChat} type="button">{t.aiClear}</button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {messages.map((message, index) => (
          <div key={index}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${message.role === "user" ? "ml-auto bg-violet-100 text-violet-900" : "bg-stone-100 text-ink"}`}>
              {message.text}
            </div>
            {message.products?.map((product) => (
              <Link key={product.sku} href={product.url} className="mt-2 block flex gap-3 rounded-xl border border-stone-100 bg-white p-3 transition hover:shadow-sm">
                {product.image_url ? <img alt="" className={`rounded-lg object-cover ${isWide ? "h-24 w-16" : "h-20 w-14"}`} src={product.image_url} /> : null}
                <div className="min-w-0 flex-1">
                  <p className={`line-clamp-1 font-bold text-ink ${isWide ? "text-sm" : "text-xs"}`}>{productName(product)}</p>
                  <p className="text-xs text-stone-500">€{product.price.toFixed(2)} · {product.sizes || "—"}</p>
                  {product.reason ? <p className={`mt-1 line-clamp-2 text-stone-400 ${isWide ? "text-[11px]" : "text-[10px]"}`}>{product.reason}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        ))}
        {loading ? <p className="text-xs italic text-stone-400">{t.aiThinking}</p> : null}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-stone-100 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:py-3">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <input
            className="min-h-11 flex-1 rounded-full border border-stone-200 px-4 py-2 text-base outline-none focus:border-violet-400 sm:text-sm"
            placeholder={productContext ? t.aiProductPlaceholder : t.aiPlaceholder}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={loading}
          />
          <button className="min-h-11 shrink-0 rounded-full bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50" disabled={loading || !input.trim()} type="submit">→</button>
        </form>
        <p className="mt-1 text-center text-[10px] text-stone-400 sm:mt-1.5">{t.aiNeedHelp}</p>
      </div>
    </div>
  );
}
