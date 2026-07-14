"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Language } from "@/lib/i18n";

const ChatAssistant = dynamic(
  () => import("@/components/chat-assistant").then((module) => module.ChatAssistant),
  { ssr: false },
);

export function ChatLauncher() {
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(false);
  const [productCtx, setProductCtx] = useState<Record<string, unknown> | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lang: Language = searchParams.get("lang") === "en" ? "en" : "el";

  useEffect(() => {
    setVisible(!pathname.startsWith("/admin"));
  }, [pathname]);

  useEffect(() => {
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
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-xl transition hover:bg-stone-800 sm:bottom-5 sm:right-5 sm:h-14 sm:w-14 animate-[fadeIn_0.3s_ease-out]"
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
