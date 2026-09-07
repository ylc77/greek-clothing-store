"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { cartItemKey } from "@/lib/cart";
import type { Language } from "@/lib/i18n";

export function CartPageClient({ language, onlineStoreEnabled }: { language: Language; onlineStoreEnabled: boolean }) {
  const {
    items,
    ready,
    availabilityState,
    totals,
    setQuantity,
    removeItem,
    refreshAvailability,
  } = useCart();
  const en = language === "en";
  const checked = useRef(false);
  const [notice, setNotice] = useState("");
  const unavailableLines = items.filter(item => item.availableQuantity < 1).length;

  useEffect(() => {
    if (!ready || checked.current || items.length === 0) return;
    checked.current = true;
    void refreshAvailability().then(result => {
      if (!result.ok) {
        setNotice(en
          ? "Current stock could not be checked. Please try again before checkout."
          : "Δεν ήταν δυνατός ο έλεγχος του τρέχοντος αποθέματος. Δοκιμάστε ξανά πριν από την ολοκλήρωση.");
      } else if (result.unavailableLines > 0) {
        setNotice(en
          ? "Some options are now out of stock. Remove them before checkout."
          : "Ορισμένες επιλογές έχουν εξαντληθεί. Αφαιρέστε τις πριν από την ολοκλήρωση.");
      } else if (result.adjustedLines > 0) {
        setNotice(en
          ? "Some quantities were reduced to match current stock."
          : "Ορισμένες ποσότητες μειώθηκαν ώστε να συμφωνούν με το τρέχον απόθεμα.");
      }
    });
  }, [en, items.length, ready, refreshAvailability]);

  async function checkAgain() {
    setNotice("");
    const result = await refreshAvailability();
    if (!result.ok) {
      setNotice(en
        ? "Current stock could not be checked. Please try again."
        : "Δεν ήταν δυνατός ο έλεγχος του τρέχοντος αποθέματος. Δοκιμάστε ξανά.");
    } else if (result.unavailableLines > 0) {
      setNotice(en
        ? "Some options are out of stock. Remove them before checkout."
        : "Ορισμένες επιλογές έχουν εξαντληθεί. Αφαιρέστε τις πριν από την ολοκλήρωση.");
    } else if (result.adjustedLines > 0) {
      setNotice(en
        ? "Quantities were updated to match current stock."
        : "Οι ποσότητες ενημερώθηκαν σύμφωνα με το τρέχον απόθεμα.");
    } else {
      setNotice(en ? "Stock is up to date." : "Το απόθεμα είναι ενημερωμένο.");
    }
  }

  if (!ready) {
    return <div className="py-20 text-center text-stone-500">{en ? "Loading cart…" : "Φόρτωση καλαθιού…"}</div>;
  }

  const checkoutReady = onlineStoreEnabled && availabilityState === "ready" && unavailableLines === 0;

  return (
    <section className="ui-container py-8 sm:py-12">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="ui-kicker">{en ? "Your selection" : "Οι επιλογές σας"}</p>
          <h1 className="mt-2 text-3xl font-black text-ink sm:text-4xl">{en ? "Shopping cart" : "Καλάθι αγορών"}</h1>
        </div>
        <span className="text-sm font-bold text-stone-500">{totals.quantity} {en ? "items" : "τεμάχια"}</span>
      </div>

      {notice ? (
        <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${unavailableLines > 0 || availabilityState === "error" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <span>{notice}</span>
          <button className="min-h-9 rounded-full border border-current px-4 text-xs" disabled={availabilityState === "checking"} onClick={() => void checkAgain()} type="button">
            {availabilityState === "checking" ? (en ? "Checking…" : "Έλεγχος…") : (en ? "Check stock again" : "Νέος έλεγχος")}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="font-bold text-stone-600">{en ? "Your cart is empty." : "Το καλάθι σας είναι άδειο."}</p>
          <Link className="ui-button-primary mt-6" href={en ? "/?lang=en" : "/"}>{en ? "Continue shopping" : "Συνέχεια αγορών"}</Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-3">
            {items.map(item => {
              const key = cartItemKey(item);
              const soldOut = item.availableQuantity < 1;
              return (
                <article className={`flex gap-4 rounded-2xl border bg-white p-3 sm:p-4 ${soldOut ? "border-red-200" : "border-stone-200"}`} key={key}>
                  <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                    {item.imageUrl ? <Image alt={en ? item.nameEn : item.nameGr} className="object-cover" fill sizes="96px" src={item.imageUrl} /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link className="font-black text-ink hover:underline" href={`/product/${encodeURIComponent(item.productSku)}${en ? "?lang=en" : ""}`}>{en ? item.nameEn : item.nameGr}</Link>
                    <p className="mt-1 text-xs font-bold text-stone-500">{item.size}{item.color ? ` · ${item.color}` : ""}</p>
                    {item.fulfillmentProfile === "pickup_only" ? <p className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-900">{en ? "Store pickup only" : "Μόνο παραλαβή από κατάστημα"}</p> : null}
                    <p className="mt-2 font-black text-terracotta">€{item.unitPrice.toFixed(2)}</p>
                    <p className={`mt-1 text-xs font-bold ${soldOut ? "text-red-600" : item.availableQuantity <= 3 ? "text-amber-700" : "text-stone-500"}`}>
                      {soldOut
                        ? (en ? "Out of stock — remove this option." : "Εξαντλήθηκε — αφαιρέστε αυτή την επιλογή.")
                        : (en ? `${item.availableQuantity} currently available` : `${item.availableQuantity} διαθέσιμα τώρα`)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button aria-label={en ? "Decrease quantity" : "Μείωση ποσότητας"} className="h-9 w-9 rounded-full border" onClick={() => setQuantity(key, item.quantity - 1)} type="button">−</button>
                      <span className="min-w-8 text-center font-black">{item.quantity}</span>
                      <button aria-label={en ? "Increase quantity" : "Αύξηση ποσότητας"} className="h-9 w-9 rounded-full border disabled:cursor-not-allowed disabled:opacity-40" disabled={soldOut || item.quantity >= Math.min(item.availableQuantity, 20)} onClick={() => setQuantity(key, item.quantity + 1)} type="button">+</button>
                      <button className="ml-auto min-h-9 px-2 text-xs font-bold text-red-600" onClick={() => removeItem(key)} type="button">{en ? "Remove" : "Αφαίρεση"}</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="h-fit rounded-3xl border border-stone-200 bg-white p-5 shadow-sm lg:sticky lg:top-28">
            <h2 className="text-lg font-black text-ink">{en ? "Order summary" : "Σύνοψη παραγγελίας"}</h2>
            <div className="mt-5 flex justify-between border-t border-stone-100 pt-4">
              <span className="font-bold text-stone-600">{en ? "Subtotal" : "Υποσύνολο"}</span>
              <span className="text-xl font-black">€{totals.subtotal.toFixed(2)}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-stone-500">{en ? "Delivery cost is calculated from the store settings at checkout. Pickup is free." : "Το κόστος παράδοσης υπολογίζεται στο ταμείο. Η παραλαβή από το κατάστημα είναι δωρεάν."}</p>
            {!checkoutReady ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">{availabilityState === "checking" ? (en ? "Checking current stock…" : "Έλεγχος τρέχοντος αποθέματος…") : unavailableLines > 0 ? (en ? "Remove sold-out items before checkout." : "Αφαιρέστε τα εξαντλημένα προϊόντα πριν από την ολοκλήρωση.") : (en ? "Current stock must be verified before checkout." : "Το τρέχον απόθεμα πρέπει να επαληθευτεί πριν από την ολοκλήρωση.")}</p> : null}
            <Link aria-disabled={!checkoutReady} className={`mt-6 flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-black ${checkoutReady ? "bg-ink text-white" : "pointer-events-none bg-stone-200 text-stone-400"}`} href={en ? "/checkout?lang=en" : "/checkout"}>{en ? "Checkout" : "Ολοκλήρωση παραγγελίας"}</Link>
          </aside>
        </div>
      )}
    </section>
  );
}
