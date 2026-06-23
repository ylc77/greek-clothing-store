"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { text, type Language } from "@/lib/i18n";

type Message = { role: "user" | "assistant"; text: string; products?: AiProduct[] };
type AiProduct = { sku: string; name_en: string; name_gr: string; price: number; stock: number; sizes: string; image_url: string; reason: string; url: string; name_cn?: string };

export function ChatAssistant({ language, productContext, onClose }: { language: Language; productContext?: Record<string, unknown> | null; onClose?: () => void }) {
  const t = text[language];
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasGreeted = useRef(false);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Send initial product context message when opened from product page
  useEffect(() => {
    if (productContext && !hasGreeted.current) {
      hasGreeted.current = true;
      const msg = language === "el"
        ? `Ενδιαφέρομαι για αυτό το προϊόν: ${productContext.productName || ""}`
        : `I'm interested in this product: ${productContext.productName || ""}`;
      setMessages([{ role: "assistant", text: t.aiGreeting }]);
      sendMessage(msg);
    } else if (!productContext) {
      setMessages([{ role: "assistant", text: t.aiGreeting }]);
    }
  }, [productContext]);

  async function sendMessage(msg?: string) {
    const text = msg || input.trim();
    if (!text || loading) return;
    if (!msg) setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { message: text, language };
      if (productContext) body.productContext = productContext;
      const r = await fetch("/api/ai-shop-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setMessages(prev => [...prev, { role: "assistant", text: d.reply || "", products: d.products || [] }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: language === "el" ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Παρακαλώ επικοινωνήστε μαζί μας μέσω WhatsApp." : "AI assistant is temporarily unavailable. Please contact us on WhatsApp." }]);
    } finally { setLoading(false); }
  }

  function productName(p: AiProduct) { return language === "el" ? (p.name_gr || p.name_en) : (p.name_en || p.name_gr); }

  const quickActions: string[] = productContext
    ? [t.aiWhatSize, t.aiSimilar, t.aiSummer, t.aiInStore]
    : [];

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[calc(100vw-24px)] max-w-[440px] h-[620px] max-h-[calc(100vh-48px)] rounded-2xl border border-stone-200 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl bg-ink px-4 py-3 text-white">
        <span className="text-sm font-black">{t.aiAssistant}</span>
        <button className="text-white/70 hover:text-white" onClick={onClose} type="button">✕</button>
      </div>

      {/* Quick actions */}
      {quickActions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-stone-100">
          {quickActions.map((q, i) => (
            <button key={i} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100" onClick={() => sendMessage(q)} type="button">{q}</button>
          ))}
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
                {p.image_url ? <img alt="" className="h-20 w-14 rounded-lg object-cover" src={p.image_url} /> : null}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-ink line-clamp-1">{productName(p)}</p>
                  <p className="text-xs text-stone-500">€{p.price.toFixed(2)} · {p.sizes || "—"}</p>
                  {p.reason ? <p className="text-[10px] text-stone-400 mt-1 line-clamp-2">{p.reason}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        ))}
        {loading ? <p className="text-xs text-stone-400 italic">{t.aiThinking}</p> : null}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-stone-100">
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
          <input
            className="flex-1 rounded-full border border-stone-200 px-4 py-2 text-sm outline-none focus:border-violet-400"
            placeholder={t.aiPlaceholder}
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
