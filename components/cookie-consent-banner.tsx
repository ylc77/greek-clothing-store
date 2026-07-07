"use client";

import { useEffect, useState } from "react";

export type CookiePreferences = { essential: true; analytics: boolean; monitoring: boolean; advertising: boolean; legalVersion: string | null; savedAt: string };
type CookieConfig = { essentialDescription: string; analyticsEnabled: boolean; monitoringEnabled: boolean; advertisingEnabled: boolean; legalVersion: string | null };
export const COOKIE_CONSENT_KEY = "cookie-consent-v2";
export const COOKIE_CONSENT_EVENT = "legal-cookie-consent-change";

export function readCookiePreferences(): CookiePreferences | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_KEY) || "null") as CookiePreferences | null; } catch { return null; }
}

export function CookieConsentBanner({ config }: { config: CookieConfig }) {
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [advertising, setAdvertising] = useState(false);

  useEffect(() => {
    const saved = readCookiePreferences();
    if (!saved || saved.legalVersion !== config.legalVersion) setVisible(true);
    else {
      setAnalytics(saved.analytics); setMonitoring(saved.monitoring); setAdvertising(saved.advertising);
      window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: saved }));
    }
    const click = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest("[data-cookie-preferences]")) { setShowPreferences(true); setVisible(true); }
    };
    window.addEventListener("click", click);
    return () => window.removeEventListener("click", click);
  }, [config.legalVersion]);

  function save(values: { analytics: boolean; monitoring: boolean; advertising: boolean }) {
    const payload: CookiePreferences = { essential: true, analytics: config.analyticsEnabled && values.analytics, monitoring: config.monitoringEnabled && values.monitoring, advertising: config.advertisingEnabled && values.advertising, legalVersion: config.legalVersion, savedAt: new Date().toISOString() };
    window.localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: payload }));
    setVisible(false);
  }

  if (!visible) return null;
  const optionalEnabled = config.analyticsEnabled || config.monitoringEnabled || config.advertisingEnabled;
  return <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4"><section className="mx-auto max-w-5xl rounded-3xl border border-stone-200 bg-white p-4 shadow-2xl shadow-stone-900/15 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="max-w-3xl"><p className="text-sm font-black text-ink">Cookie preferences</p><p className="mt-1 text-xs leading-5 text-stone-500 sm:text-sm">{config.essentialDescription} Non-essential services only load after consent. Τα μη απαραίτητα εργαλεία φορτώνονται μόνο μετά από συγκατάθεση.</p>
    {showPreferences ? <div className="mt-3 grid gap-2 text-left text-xs text-stone-600 sm:grid-cols-2"><label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked readOnly type="checkbox" /><span><b>Essential</b><br />Required for core operation and preferences.</span></label>{config.analyticsEnabled ? <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} type="checkbox" /><span><b>Analytics</b><br />Optional usage analytics.</span></label> : null}{config.monitoringEnabled ? <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked={monitoring} onChange={(event) => setMonitoring(event.target.checked)} type="checkbox" /><span><b>Error monitoring</b><br />Optional diagnostics.</span></label> : null}{config.advertisingEnabled ? <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked={advertising} onChange={(event) => setAdvertising(event.target.checked)} type="checkbox" /><span><b>Advertising / tracking</b><br />Optional advertising measurement.</span></label> : null}</div> : null}
  </div><div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">{optionalEnabled ? <button className="min-h-11 rounded-full bg-ink px-5 text-sm font-black text-white hover:bg-stone-800" onClick={() => save({ analytics: true, monitoring: true, advertising: true })} type="button">Accept all</button> : null}<button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => save({ analytics: false, monitoring: false, advertising: false })} type="button">{optionalEnabled ? "Reject non-essential" : "Accept necessary"}</button>{showPreferences ? <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => save({ analytics, monitoring, advertising })} type="button">Save preferences</button> : optionalEnabled ? <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => setShowPreferences(true)} type="button">Manage preferences</button> : null}</div></div></section></div>;
}
