"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatAssistant } from "@/components/chat-assistant";
import type { Language } from "@/lib/i18n";

export function ChatLauncher() {
  const [lang, setLang] = useState<Language>("el");
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(false);
  const [productCtx, setProductCtx] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.pathname.startsWith("/admin")) { setVisible(false); return; }
      setLang(url.searchParams.get("lang") === "en" ? "en" : "el");
    } catch { /* keep default */ }

    // Listen for product-context open events
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setProductCtx(detail.product || null);
      setOpen(true);
    };
    window.addEventListener("openAiChat", handler);
    return () => window.removeEventListener("openAiChat", handler);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setProductCtx(null);
  }, []);

  if (!visible) return null;

  return open ? (
    <ChatAssistant language={lang} productContext={productCtx} onClose={handleClose} />
  ) : (
    <button
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white shadow-xl hover:bg-stone-800 transition animate-[fadeIn_0.3s_ease-out]"
      onClick={() => setOpen(true)}
      aria-label="AI Assistant"
      type="button"
    >
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    </button>
  );
}
