"use client";

import { useEffect, useState } from "react";

type CookieConsent = "accepted" | "rejected" | "preferences";

const STORAGE_KEY = "cookie-consent-v1";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function save(consent: CookieConsent, preferences?: { analytics: boolean; marketing: boolean }) {
    const payload = {
      consent,
      analytics: preferences?.analytics ?? consent === "accepted",
      marketing: preferences?.marketing ?? consent === "accepted",
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4">
      <section className="mx-auto max-w-5xl rounded-3xl border border-stone-200 bg-white p-4 shadow-2xl shadow-stone-900/15 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-black text-ink">Cookie preferences</p>
            <p className="mt-1 text-xs leading-5 text-stone-500 sm:text-sm">
              We use essential cookies to keep the site working. Analytics or marketing cookies are only used if you allow them.
              Χρησιμοποιούμε απαραίτητα cookies για τη λειτουργία του ιστότοπου. Τα analytics ή marketing cookies ενεργοποιούνται μόνο με τη συγκατάθεσή σας.
            </p>
            {showPreferences ? (
              <div className="mt-3 grid gap-2 text-left text-xs text-stone-600 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <input checked readOnly type="checkbox" />
                  <span><b>Essential</b><br />Required for language, security, and basic site operation.</span>
                </label>
                <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                  <input checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} type="checkbox" />
                  <span><b>Analytics</b><br />Helps us understand site usage if enabled.</span>
                </label>
                <label className="flex items-start gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-3 sm:col-span-2">
                  <input checked={marketing} onChange={(event) => setMarketing(event.target.checked)} type="checkbox" />
                  <span><b>Marketing</b><br />Reserved for future campaigns. Not loaded before consent.</span>
                </label>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <button className="min-h-11 rounded-full bg-ink px-5 text-sm font-black text-white hover:bg-stone-800" onClick={() => save("accepted")} type="button">
              Accept all
            </button>
            <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => save("rejected", { analytics: false, marketing: false })} type="button">
              Reject non-essential
            </button>
            {showPreferences ? (
              <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => save("preferences", { analytics, marketing })} type="button">
                Save preferences
              </button>
            ) : (
              <button className="min-h-11 rounded-full border border-stone-300 bg-white px-5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => setShowPreferences(true)} type="button">
                Manage preferences
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
