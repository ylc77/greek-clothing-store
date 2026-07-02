"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Language } from "@/lib/i18n";

const languages: Array<{ code: Language; short: string; label: string }> = [
  { code: "el", short: "EL", label: "Ελληνικά (EL)" },
  { code: "en", short: "EN", label: "English (EN)" },
];

function languageHref(pathname: string, searchParams: URLSearchParams, language: Language) {
  const params = new URLSearchParams(searchParams);

  if (language === "en") {
    params.set("lang", "en");
  } else {
    params.delete("lang");
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function LanguageSelector({ language }: { language: Language }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeLanguage = languages.find((item) => item.code === language) || languages[0];

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="inline-flex h-11 items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-4 text-sm font-black text-ink shadow-sm shadow-stone-900/5 backdrop-blur transition hover:border-stone-300 hover:shadow-md"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <FlagIcon code={activeLanguage.code} />
        <span>{activeLanguage.short}</span>
        <svg aria-hidden="true" className={`h-3.5 w-3.5 text-stone-400 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-900/10">
          {languages.map((item) => (
            <Link
              className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-4 text-sm font-black text-ink last:border-b-0 hover:bg-stone-50"
              href={languageHref(pathname, searchParams, item.code)}
              key={item.code}
              onClick={() => setOpen(false)}
            >
              <span className="flex items-center gap-3">
                <FlagIcon code={item.code} />
                {item.label}
              </span>
              {item.code === language ? (
                <svg aria-hidden="true" className="h-4 w-4 text-olive" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlagIcon({ code }: { code: Language }) {
  if (code === "el") {
    return (
      <span className="relative inline-flex h-4 w-6 shrink-0 overflow-hidden rounded-[3px] border border-stone-200 bg-[#0d5eaf]" aria-hidden="true">
        <span className="absolute inset-x-0 top-[3px] h-[2px] bg-white" />
        <span className="absolute inset-x-0 top-[7px] h-[2px] bg-white" />
        <span className="absolute inset-x-0 top-[11px] h-[2px] bg-white" />
        <span className="absolute left-0 top-0 h-[10px] w-[10px] bg-[#0d5eaf]" />
        <span className="absolute left-[4px] top-0 h-[10px] w-[2px] bg-white" />
        <span className="absolute left-0 top-[4px] h-[2px] w-[10px] bg-white" />
      </span>
    );
  }

  return (
    <span className="relative inline-flex h-4 w-6 shrink-0 overflow-hidden rounded-[3px] border border-stone-200 bg-[#012169]" aria-hidden="true">
      <span className="absolute left-[-2px] top-[7px] h-[2px] w-8 rotate-[33deg] bg-white" />
      <span className="absolute left-[-2px] top-[7px] h-[2px] w-8 rotate-[-33deg] bg-white" />
      <span className="absolute left-[-2px] top-[7px] h-[1px] w-8 rotate-[33deg] bg-[#c8102e]" />
      <span className="absolute left-[-2px] top-[7px] h-[1px] w-8 rotate-[-33deg] bg-[#c8102e]" />
      <span className="absolute left-0 top-[6px] h-1 w-full bg-white" />
      <span className="absolute left-[10px] top-0 h-full w-1 bg-white" />
      <span className="absolute left-0 top-[7px] h-[2px] w-full bg-[#c8102e]" />
      <span className="absolute left-[11px] top-0 h-full w-[2px] bg-[#c8102e]" />
    </span>
  );
}
