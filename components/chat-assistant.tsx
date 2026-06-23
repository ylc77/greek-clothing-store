"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { text, type Language } from "@/lib/i18n";

type Message = { role: "user" | "assistant"; text: string; products?: AiProduct[] };
type AiProduct = { sku: string; name_en: string; name_gr: string; price: number; stock: number; sizes: string; image_url: string; reason: string; url: string };

export function ChatAssistant({ language }: { language: Language }) {
  const t = text[language];
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: t.aiGreeting }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const msg = input.trim(); if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: msg }]);
    setLoading(true);
    try {
      const r = await fetch("/api/ai-shop-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, language }),
      });
      const d = await r.json();
      setMessages(prev => [...prev, { role: "assistant", text: d.reply || "", products: d.products || [] }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: language === "el" ? "Συγγνώμη, κάτι πήγε στραβά." : "Sorry, something went wrong." }]);
    } finally { setLoading(false); }
  }

  function productName(p: AiProduct) { return language === "el" ? (p.name_gr || p.name_en) : (p.name_en || p.name_gr); }

  return (
    <>
      {/* Floating button */}
      {!open ? (
        <button
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white shadow-xl hover:bg-stone-800 transition"
          onClick={() => setOpen(true)}
          aria-label={t.aiAssistant}
          type="button"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      ) : null}

      {/* Chat panel */}
      {open ? (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[calc(100vw-32px)] max-w-[380px] h-[520px] max-h-[calc(100vh-100px)] rounded-2xl border border-stone-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl bg-ink px-4 py-3 text-white">
            <span className="text-sm font-black">{t.aiAssistant}</span>
            <button className="text-white/70 hover:text-white" onClick={() => setOpen(false)} type="button">✕</button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i}>
                <div className={`text-sm leading-relaxed rounded-xl px-3 py-2 max-w-[85%] ${m.role === "user" ? "bg-ink text-white ml-auto" : "bg-stone-100 text-ink"}`}>
                  {m.text}
                </div>
                {m.products?.map(p => (
                  <Link key={p.sku} href={p.url} className="mt-2 flex gap-3 rounded-xl border border-stone-100 bg-white p-3 hover:shadow-sm transition block">
                    {p.image_url ? <img alt="" className="h-16 w-12 rounded-lg object-cover" src={p.image_url} /> : null}
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
          <div className="border-t border-stone-100 px-4 py-3">
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send(); }}>
              <input
                className="flex-1 rounded-full border border-stone-200 px-4 py-2 text-sm outline-none focus:border-ink"
                placeholder={t.aiPlaceholder}
                value={input}
                onChange={e => setInput(e.target.value)}
                disabled={loading}
              />
              <button
                className="shrink-0 rounded-full bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-50"
                disabled={loading || !input.trim()}
                type="submit"
              >
                →
              </button>
            </form>
            <p className="mt-1.5 text-[10px] text-stone-400 text-center">{language === "el" ? "Μόνο προϊόντα που υπάρχουν στο κατάστημα" : "Only products available in-store"}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
