"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export type CookiePreferences = { essential: true; analytics: boolean; monitoring: boolean; advertising: boolean; legalVersion: string | null; savedAt: string };
type CookieConfig = { essentialDescription: string; analyticsEnabled: boolean; monitoringEnabled: boolean; advertisingEnabled: boolean; legalVersion: string | null };
export const COOKIE_CONSENT_KEY = "cookie-consent-v2";
export const COOKIE_CONSENT_EVENT = "legal-cookie-consent-change";

export function readCookiePreferences(): CookiePreferences | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_KEY) || "null") as CookiePreferences | null; } catch { return null; }
}

export function CookieConsentBanner({ config }: { config: CookieConfig }) {
  const pathname = usePathname();
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

  if (!visible || pathname.startsWith("/admin")) return null;
  const optionalEnabled = config.analyticsEnabled || config.monitoringEnabled || config.advertisingEnabled;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4">
      <section
        aria-labelledby="cookie-consent-title"
        className="mx-auto max-w-5xl rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl shadow-stone-900/15 sm:rounded-3xl sm:p-5"
        role="dialog"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
          <div className="max-w-3xl">
            <p className="text-sm font-black text-ink" id="cookie-consent-title">Cookie preferences</p>
            <p className="mt-1 text-xs leading-5 text-stone-500 sm:text-sm">
              Essential storage keeps the shop working. Optional tools load only after consent. Τα απαραίτητα δεδομένα διατηρούν το κατάστημα σε λειτουργία.
              {" "}<a className="font-bold text-ink underline underline-offset-2" href="/cookie-policy">Cookie policy</a>
            </p>

            {showPreferences ? (
              <div className="mt-3 grid gap-2 text-left text-xs text-stone-600 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <input checked readOnly type="checkbox" />
                  <span><b>Essential</b><br />{config.essentialDescription || "Required for core operation and preferences."}</span>
                </label>
                {config.analyticsEnabled ? <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} type="checkbox" /><span><b>Analytics</b><br />Optional usage analytics.</span></label> : null}
                {config.monitoringEnabled ? <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked={monitoring} onChange={(event) => setMonitoring(event.target.checked)} type="checkbox" /><span><b>Error monitoring</b><br />Optional diagnostics.</span></label> : null}
                {config.advertisingEnabled ? <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3"><input checked={advertising} onChange={(event) => setAdvertising(event.target.checked)} type="checkbox" /><span><b>Advertising / tracking</b><br />Optional advertising measurement.</span></label> : null}
              </div>
            ) : null}
          </div>

          <div className="grid shrink-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-row lg:flex-col">
            {optionalEnabled ? <button className="min-h-11 rounded-full bg-ink px-5 text-sm font-black text-white hover:bg-stone-800" onClick={() => save({ analytics: true, monitoring: true, advertising: true })} type="button">Accept all</button> : null}
            <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => save({ analytics: false, monitoring: false, advertising: false })} type="button">{optionalEnabled ? "Reject non-essential" : "Accept necessary"}</button>
            {showPreferences ? <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => save({ analytics, monitoring, advertising })} type="button">Save preferences</button> : optionalEnabled ? <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => setShowPreferences(true)} type="button">Manage preferences</button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
