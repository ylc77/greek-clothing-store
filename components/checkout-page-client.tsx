"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import {
  BoxNowLockerSelector,
  type SelectedBoxNowLocker,
} from "@/components/boxnow-locker-selector";
import { CheckoutOperationStore } from "@/lib/checkout-operation";
import type { Language } from "@/lib/i18n";
import type { BusinessSettings } from "@/lib/settings";

type Method = "box_now" | "store_pickup";
type QuoteOption = {
  available: boolean;
  feeCents: number;
  fee: number;
  reason: "disabled" | "pickup_only_item" | "package_limit" | "minimum_not_met" | null;
  amountMissingCents: number;
  amountMissing?: number;
};
type Quote = {
  merchandiseSubtotalCents: number;
  merchandiseSubtotal: number;
  containsPickupOnly: boolean;
  boxNow: QuoteOption;
  storePickup: QuoteOption;
};

function money(value: number, language: Language) {
  return new Intl.NumberFormat(language === "en" ? "en-IE" : "el-GR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function CheckoutPageClient({
  language,
  settings,
  legalReady,
}: {
  language: Language;
  settings: BusinessSettings;
  legalReady: boolean;
}) {
  const en = language === "en";
  const { items, clear, availabilityState, refreshAvailability } = useCart();
  const operationStore = useRef<CheckoutOperationStore | null>(null);
  const [method, setMethod] = useState<Method>("store_pickup");
  const [locker, setLocker] = useState<SelectedBoxNowLocker | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    addressLine1: "",
    city: "",
    postalCode: "",
    notes: "",
  });
  const [accepted, setAccepted] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteState, setQuoteState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const cartFingerprint = useMemo(
    () =>
      JSON.stringify(
        items.map((item) => ({
          productSku: item.productSku,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
        })),
      ),
    [items],
  );

  useEffect(() => {
    if (!items.length) return;
    const controller = new AbortController();
    setQuoteState("loading");
    void fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: JSON.parse(cartFingerprint) }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(String(data.error || "Quote unavailable"));
        setQuote(data as Quote);
        setQuoteState("ready");
        if (!(data as Quote).boxNow.available) setMethod("store_pickup");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteState("failed");
        setMessage(
          error instanceof Error
            ? error.message
            : en
              ? "Checkout pricing is unavailable."
              : "Ο υπολογισμός της παραγγελίας δεν είναι διαθέσιμος.",
        );
      });
    return () => controller.abort();
  }, [cartFingerprint, en, items.length]);

  const selectedOption =
    method === "box_now" ? quote?.boxNow : quote?.storePickup;
  const total =
    ((quote?.merchandiseSubtotalCents || 0) + (selectedOption?.feeCents || 0)) /
    100;

  async function submit() {
    if (!accepted) {
      setMessage(
        en
          ? "Please accept the Terms of Sale and Privacy Policy."
          : "Αποδεχθείτε τους Όρους Πώλησης και την Πολιτική Απορρήτου.",
      );
      return;
    }
    if (method === "box_now" && !locker) {
      setMessage(
        en ? "Choose a BOX NOW Locker." : "Επιλέξτε ένα BOX NOW Locker.",
      );
      return;
    }
    if (
      !quote ||
      !selectedOption?.available ||
      !legalReady ||
      !settings.online_store_enabled ||
      !settings.viva_payments_enabled
    ) {
      setMessage(
        en
          ? "Online payment is not available."
          : "Η ηλεκτρονική πληρωμή δεν είναι διαθέσιμη.",
      );
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const availability = await refreshAvailability();
      if (!availability.ok)
        throw new Error(
          en
            ? "Current stock could not be verified. Please try again."
            : "Δεν ήταν δυνατή η επαλήθευση του αποθέματος. Δοκιμάστε ξανά.",
        );
      if (availability.unavailableLines > 0)
        throw new Error(
          en
            ? "Some selected options are out of stock. Return to the cart to remove them."
            : "Ορισμένες επιλογές έχουν εξαντληθεί. Επιστρέψτε στο καλάθι για να τις αφαιρέσετε.",
        );
      if (availability.adjustedLines > 0)
        throw new Error(
          en
            ? "Available quantities changed. Review the updated cart before paying."
            : "Οι διαθέσιμες ποσότητες άλλαξαν. Ελέγξτε το καλάθι πριν από την πληρωμή.",
        );
      const verifiedItems = availability.items;
      const fingerprint = JSON.stringify({
        method,
        locker,
        form,
        items: verifiedItems.map((item) => ({
          productSku: item.productSku,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
        })),
        accepted,
      });
      operationStore.current ||= new CheckoutOperationStore(
        window.sessionStorage,
      );
      const operation = operationStore.current.getOrCreate(fingerprint);
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: operation.id,
          accessToken: operation.accessToken,
          fulfillmentMethod: method,
          locker,
          customer: form,
          items: verifiedItems.map((item) => ({
            productSku: item.productSku,
            size: item.size,
            color: item.color,
            quantity: item.quantity,
          })),
          locale: language,
          legalAccepted: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "ITEM_UNAVAILABLE") await refreshAvailability();
        throw new Error(
          data.error ||
            (en
              ? "Payment could not be started."
              : "Δεν ήταν δυνατή η έναρξη της πληρωμής."),
        );
      }
      const orderNumber = String(data.order?.orderNumber || "");
      const checkoutUrl = String(data.checkoutUrl || "");
      if (!orderNumber || !checkoutUrl.startsWith("https://"))
        throw new Error(
          en
            ? "Payment redirect is unavailable."
            : "Η ανακατεύθυνση πληρωμής δεν είναι διαθέσιμη.",
        );
      window.localStorage.setItem(
        `clothing-store:order-access:${orderNumber}`,
        operation.accessToken,
      );
      window.localStorage.setItem(
        "clothing-store:last-online-order",
        orderNumber,
      );
      operationStore.current.complete(operation.id);
      clear();
      window.location.assign(checkoutUrl);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : en
            ? "Payment could not be started."
            : "Δεν ήταν δυνατή η έναρξη της πληρωμής.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!items.length)
    return (
      <section className="ui-container py-16 text-center">
        <h1 className="text-3xl font-black">
          {en ? "Your cart is empty" : "Το καλάθι σας είναι άδειο"}
        </h1>
        <Link className="ui-button-primary mt-6" href={en ? "/?lang=en" : "/"}>
          {en ? "Continue shopping" : "Συνέχεια αγορών"}
        </Link>
      </section>
    );
  return (
    <section className="ui-container py-8 sm:py-12">
      <div className="mb-8">
        <p className="ui-kicker">
          {en ? "Secure online payment" : "Ασφαλής ηλεκτρονική πληρωμή"}
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">
          {en ? "Checkout" : "Ολοκλήρωση παραγγελίας"}
        </h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <h2 className="text-lg font-black">
              {en ? "Collection method" : "Τρόπος παραλαβής"}
            </h2>
            {quoteState === "loading" ? (
              <p className="mt-4 text-sm text-stone-500">
                {en
                  ? "Checking delivery options…"
                  : "Έλεγχος επιλογών παράδοσης…"}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                className={`rounded-2xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${method === "box_now" ? "border-ink bg-stone-50" : "border-stone-200"}`}
                disabled={!quote?.boxNow.available}
                onClick={() => setMethod("box_now")}
                type="button"
              >
                <b>BOX NOW Locker</b>
                <span className="mt-1 block text-xs text-stone-500">
                  {quote?.boxNow.available
                    ? quote.boxNow.feeCents
                      ? `${en ? "Shipping" : "Μεταφορικά"}: ${money(quote.boxNow.fee, language)}`
                      : en
                        ? "Free shipping"
                        : "Δωρεάν αποστολή"
                    : quote?.boxNow.reason === "pickup_only_item"
                      ? en
                        ? "A pickup-only item is in the cart."
                        : "Το καλάθι περιέχει προϊόν μόνο για παραλαβή."
                      : quote?.boxNow.reason === "package_limit"
                        ? en
                          ? "This order exceeds the BOX NOW parcel limits."
                          : "Η παραγγελία υπερβαίνει τα όρια δέματος BOX NOW."
                        : quote?.boxNow.reason === "minimum_not_met"
                          ? en
                            ? `Add ${money(quote.boxNow.amountMissing || 0, language)} more.`
                            : `Προσθέστε ακόμη ${money(quote.boxNow.amountMissing || 0, language)}.`
                          : en
                            ? "Not available"
                            : "Μη διαθέσιμο"}
                </span>
              </button>
              <button
                className={`rounded-2xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${method === "store_pickup" ? "border-ink bg-stone-50" : "border-stone-200"}`}
                disabled={!quote?.storePickup.available}
                onClick={() => setMethod("store_pickup")}
                type="button"
              >
                <b>
                  {en
                    ? "Free store pickup"
                    : "Δωρεάν παραλαβή από το κατάστημα"}
                </b>
                <span className="mt-1 block text-xs text-stone-500">
                  {en
                    ? settings.pickup_instructions_en
                    : settings.pickup_instructions_gr}
                </span>
              </button>
            </div>
            {method === "box_now" ? (
              <BoxNowLockerSelector
                language={language}
                onChange={setLocker}
                value={locker}
              />
            ) : (
              <div className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm text-stone-600">
                <b className="block text-ink">{settings.business_name}</b>
                {settings.address}
                <br />
                {settings.opening_hours}
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <h2 className="text-lg font-black">
              {en ? "Contact details" : "Στοιχεία επικοινωνίας"}
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ["name", en ? "Full name" : "Ονοματεπώνυμο"],
                ["email", "Email"],
                ["phone", en ? "Phone" : "Τηλέφωνο"],
              ].map(([key, label]) => (
                <label className="text-sm font-bold" key={key}>
                  {label}
                  <input
                    className="input mt-2"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    value={form[key as keyof typeof form]}
                  />
                </label>
              ))}
            </div>
            <label className="mt-4 block text-sm font-bold">
              {en ? "Order notes (optional)" : "Σημειώσεις (προαιρετικά)"}
              <textarea
                className="input mt-2 min-h-24"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                value={form.notes}
              />
            </label>
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6">
            <input
              checked={accepted}
              className="mt-1"
              onChange={(event) => setAccepted(event.target.checked)}
              type="checkbox"
            />
            <span>
              {en ? "I accept the" : "Αποδέχομαι τους"}{" "}
              <Link
                className="font-bold underline"
                href={en ? "/terms-of-service?lang=en" : "/terms-of-service"}
              >
                {en ? "Terms of Sale" : "Όρους Πώλησης"}
              </Link>{" "}
              {en ? "and the" : "και την"}{" "}
              <Link
                className="font-bold underline"
                href={en ? "/privacy-policy?lang=en" : "/privacy-policy"}
              >
                {en ? "Privacy Policy" : "Πολιτική Απορρήτου"}
              </Link>
              .
            </span>
          </label>
          {message ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
              {message}
            </p>
          ) : null}
        </div>
        <aside className="h-fit rounded-3xl border border-stone-200 bg-white p-5 lg:sticky lg:top-28">
          <h2 className="text-lg font-black">
            {en ? "Order summary" : "Σύνοψη"}
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            {items.map((item) => (
              <div
                className="flex justify-between gap-3"
                key={`${item.productSku}-${item.size}-${item.color}`}
              >
                <span className="min-w-0 truncate">
                  {item.quantity}× {en ? item.nameEn : item.nameGr} ·{" "}
                  {item.size}
                </span>
                <b>{money(item.quantity * item.unitPrice, language)}</b>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t pt-4 text-sm">
            <div className="flex justify-between">
              <span>{en ? "Merchandise" : "Προϊόντα"}</span>
              <b>
                {money((quote?.merchandiseSubtotalCents || 0) / 100, language)}
              </b>
            </div>
            <div className="flex justify-between">
              <span>{en ? "Shipping" : "Μεταφορικά"}</span>
              <b>{money((selectedOption?.feeCents || 0) / 100, language)}</b>
            </div>
            <div className="flex justify-between pt-2 text-lg">
              <span className="font-black">{en ? "Total" : "Σύνολο"}</span>
              <b>{money(total, language)}</b>
            </div>
          </div>
          <button
            className="mt-6 min-h-13 w-full rounded-full bg-ink px-5 text-sm font-black text-white disabled:bg-stone-300"
            disabled={
              submitting ||
              quoteState !== "ready" ||
              availabilityState !== "ready" ||
              !selectedOption?.available ||
              (method === "box_now" && !locker) ||
              !legalReady ||
              !settings.online_store_enabled ||
              !settings.viva_payments_enabled
            }
            onClick={() => void submit()}
            type="button"
          >
            {submitting
              ? en
                ? "Opening secure payment…"
                : "Άνοιγμα ασφαλούς πληρωμής…"
              : en
                ? "Continue to Viva payment"
                : "Συνέχεια στην πληρωμή Viva"}
          </button>
          <p className="mt-3 text-center text-xs text-stone-500">
            {en
              ? "Your order is confirmed only after Viva verifies the payment."
              : "Η παραγγελία επιβεβαιώνεται μόνο μετά την επαλήθευση της πληρωμής από τη Viva."}
          </p>
        </aside>
      </div>
    </section>
  );
}
