"use client";

import { useEffect, useId, useState } from "react";
import type { Language } from "@/lib/i18n";

export type SelectedBoxNowLocker = { id: string; name: string; address: string; postalCode: string };

type BoxNowSelection = {
  boxnowLockerId?: unknown;
  boxnowLockerName?: unknown;
  boxnowLockerAddressLine1?: unknown;
  boxnowLockerPostalCode?: unknown;
};

function parseLocker(value: BoxNowSelection): SelectedBoxNowLocker | null {
  const id = String(value.boxnowLockerId || "").trim().slice(0, 120);
  const address = String(value.boxnowLockerAddressLine1 || "").trim().slice(0, 300);
  const postalCode = String(value.boxnowLockerPostalCode || "").trim().slice(0, 20);
  const name = String(value.boxnowLockerName || address || `BOX NOW ${id}`).trim().slice(0, 200);
  return id && name ? { id, name, address, postalCode } : null;
}

export function BoxNowLockerSelector({ language, value, onChange }: { language: Language; value: SelectedBoxNowLocker | null; onChange: (locker: SelectedBoxNowLocker | null) => void }) {
  const en = language === "en";
  const reactId = useId();
  const containerId = `boxnowmap-${reactId.replace(/[^a-z0-9_-]/gi, "")}`;
  const partnerId = String(process.env.NEXT_PUBLIC_BOXNOW_PARTNER_ID || "").trim();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!partnerId || !/^\d{1,20}$/.test(partnerId)) return;
    const globalWindow = window as typeof window & { _bn_map_widget_config?: Record<string, unknown> };
    globalWindow._bn_map_widget_config = {
      partnerId: Number(partnerId),
      parentElement: `#${containerId}`,
      type: "popup",
      gps: true,
      autoclose: true,
      language: en ? "en" : "gr",
      countryCode: "gr",
      afterSelect(selected: BoxNowSelection) {
        const locker = parseLocker(selected);
        if (locker) onChange(locker);
      },
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-boxnow-widget="v5"]');
    if (existing) {
      setReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://widget-cdn.boxnow.gr/map-widget/client/v5.js";
    script.async = true;
    script.defer = true;
    script.dataset.boxnowWidget = "v5";
    script.onload = () => setReady(true);
    script.onerror = () => setReady(false);
    document.head.appendChild(script);
  }, [containerId, en, onChange, partnerId]);

  const configured = Boolean(partnerId && /^\d{1,20}$/.test(partnerId));
  return <div className="mt-4 rounded-2xl border border-stone-200 p-4">
    <div className="hidden" id={containerId} />
    {value ? <div className="flex items-start justify-between gap-4"><div><b className="block text-sm">{value.name}</b><span className="mt-1 block text-xs leading-5 text-stone-500">{value.address}{value.postalCode ? ` · ${value.postalCode}` : ""}</span></div><button className="boxnow-map-widget-button text-xs font-black underline" type="button">{en ? "Change" : "Αλλαγή"}</button></div> : <button className="boxnow-map-widget-button min-h-11 w-full rounded-full bg-ink px-4 text-sm font-black text-white disabled:bg-stone-300" disabled={!configured || !ready} type="button">{configured ? (ready ? (en ? "Choose a BOX NOW Locker" : "Επιλέξτε BOX NOW Locker") : (en ? "Loading Locker map…" : "Φόρτωση χάρτη Locker…")) : (en ? "Locker map is not configured" : "Ο χάρτης Locker δεν έχει ρυθμιστεί")}</button>}
  </div>;
}
