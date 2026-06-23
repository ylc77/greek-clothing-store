"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { text, type Language } from "@/lib/i18n";

type Message = { role: "user" | "assistant"; text: string; products?: AiProduct[] };
type AiProduct = { sku: string; name_en: string; name_gr: string; price: number; stock: number; sizes: string; image_url: string; reason: string; url: string };

export function ChatAssistant({ language, productContext, onClose }: { language: Language; productContext?: Record<string, unknown> | null; onClose?: () => void }) {
  const t = text[language];
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: t.aiGreeting }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(() => { try { return !!productContext || localStorage.getItem("ai_chat_size") === "expanded"; } catch { return !!productContext; } });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(msg?: string) {
    const text = msg || input.trim();
    if (!text || loading) return;
    if (!msg) setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { message: text, language };
      if (productContext) body.productContext = productContext;
      const r = await fetch("/api/ai-shop-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      setMessages(prev => [...prev, { role: "assistant", text: d.reply || "", products: d.products || [] }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: language === "el" ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος." : "AI assistant is temporarily unavailable." }]);
    } finally { setLoading(false); }
  }

  function productName(p: AiProduct) { return language === "el" ? (p.name_gr || p.name_en) : (p.name_en || p.name_gr); }
  function toggleExpand() { setExpanded(prev => { const next = !prev; try { localStorage.setItem("ai_chat_size", next ? "expanded" : "compact"); } catch {} return next; }); }
  function clearChat() { setMessages([{ role: "assistant", text: t.aiGreeting }]); }

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
  const winH = isWide ? "h-[760px]" : "h-[620px]";

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex flex-col w-[calc(100vw-24px)] ${winW} ${winH} max-h-[calc(100vh-48px)] rounded-2xl border border-stone-200 bg-white shadow-2xl`}>
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl bg-ink px-4 py-3 text-white shrink-0">
        <span className="text-sm font-black">{t.aiAssistant}</span>
        <div className="flex items-center gap-1">
          {!isMobile ? (
            <button className="text-white/60 hover:text-white px-1" onClick={toggleExpand} type="button" title={expanded ? "缩小" : "放大"}>
              {expanded ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" /><line x1="9" y1="4" x2="9" y2="2" /><line x1="15" y1="4" x2="15" y2="2" /><line x1="9" y1="20" x2="9" y2="22" /><line x1="15" y1="20" x2="15" y2="22" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              )}
            </button>
          ) : null}
          <button className="text-white/70 hover:text-white" onClick={onClose} type="button">✕</button>
        </div>
      </div>

      {/* Product context card */}
      {productContext ? (
        <div className="mx-4 mt-3 flex gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3 shrink-0">
          {productContext.imageUrl ? <img alt="" className="h-16 w-12 rounded-lg object-cover" src={String(productContext.imageUrl)} /> : null}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-violet-600 uppercase">{t.aiProductLabel}</p>
            <p className="text-xs font-bold text-ink line-clamp-1 mt-0.5">{String(productContext.productName || "")}</p>
            <p className="text-[11px] text-stone-500 mt-0.5">€{Number(productContext.price || 0).toFixed(2)} · {String(productContext.sizes || "—")} · {Number(productContext.stock || 0) > 0 ? (language === "el" ? "Σε απόθεμα" : "In stock") : (language === "el" ? "Εξαντλημένο" : "Out of stock")}</p>
          </div>
        </div>
      ) : null}

      {/* Quick actions */}
      {quickBtns.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2 pb-1 shrink-0">
          {quickBtns.map((q, i) => (
            <button key={i} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100" onClick={() => sendMessage(q.prompt)} type="button">{q.label}</button>
          ))}
        </div>
      ) : null}

      {/* Clear button */}
      {messages.length > 1 ? (
        <div className="px-4 pt-1 shrink-0 text-right">
          <button className="text-[10px] text-stone-400 hover:text-ink underline" onClick={clearChat} type="button">{t.aiClear}</button>
        </div>
      ) : null}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i}>
            <div className={`text-sm leading-relaxed rounded-xl px-3 py-2 max-w-[85%] ${m.role === "user" ? "bg-violet-100 text-violet-900 ml-auto" : "bg-stone-100 text-ink"}`}>
              {m.text}
            </div>
            {m.products?.map(p => (
              <Link key={p.sku} href={p.url} className="mt-2 flex gap-3 rounded-xl border border-stone-100 bg-white p-3 hover:shadow-sm transition block">
                {p.image_url ? <img alt="" className={`rounded-lg object-cover ${isWide ? "h-24 w-16" : "h-20 w-14"}`} src={p.image_url} /> : null}
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-ink line-clamp-1 ${isWide ? "text-sm" : "text-xs"}`}>{productName(p)}</p>
                  <p className={`text-stone-500 ${isWide ? "text-xs" : "text-xs"}`}>€{p.price.toFixed(2)} · {p.sizes || "—"}</p>
                  {p.reason ? <p className={`text-stone-400 mt-1 line-clamp-2 ${isWide ? "text-[11px]" : "text-[10px]"}`}>{p.reason}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        ))}
        {loading ? <p className="text-xs text-stone-400 italic">{t.aiThinking}</p> : null}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-stone-100 shrink-0">
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
          <input
            className="flex-1 rounded-full border border-stone-200 px-4 py-2 text-sm outline-none focus:border-violet-400"
            placeholder={productContext ? t.aiProductPlaceholder : t.aiPlaceholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button className="shrink-0 rounded-full bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50" disabled={loading || !input.trim()} type="submit">→</button>
        </form>
        <p className="mt-1.5 text-[10px] text-stone-400 text-center">{t.aiNeedHelp}</p>
      </div>
    </div>
  );
}
