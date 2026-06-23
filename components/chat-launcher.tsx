"use client";

import { useEffect, useState } from "react";
import { ChatAssistant } from "@/components/chat-assistant";
import type { Language } from "@/lib/i18n";

export function ChatLauncher() {
  const [lang, setLang] = useState<Language>("el");
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      // Hide on admin pages
      if (url.pathname.startsWith("/admin")) { setVisible(false); return; }
      setLang(url.searchParams.get("lang") === "en" ? "en" : "el");
    } catch { /* keep default */ }
  }, []);

  if (!visible) return null;
  return <ChatAssistant language={lang} />;
}
