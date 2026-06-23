"use client";

import { useEffect, useState } from "react";
import { ChatAssistant } from "@/components/chat-assistant";
import type { Language } from "@/lib/i18n";

export function ChatLauncher() {
  const [lang, setLang] = useState<Language>("el");

  useEffect(() => {
    try {
      const p = new URL(window.location.href).searchParams;
      setLang(p.get("lang") === "en" ? "en" : "el");
    } catch { /* keep default */ }
  }, []);

  return <ChatAssistant language={lang} />;
}
