"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";

export function CheckoutReturnClient({ language, failed = false }: { language: Language; failed?: boolean }) {
  const en = language === "en";
  const [orderNumber, setOrderNumber] = useState("");
  useEffect(() => { setOrderNumber(window.localStorage.getItem("clothing-store:last-online-order") || ""); }, []);
  return <section className="ui-container py-16 text-center"><div className="mx-auto max-w-xl rounded-3xl border border-stone-200 bg-white p-7"><p className="ui-kicker">Viva Smart Checkout</p><h1 className="mt-3 text-3xl font-black">{failed ? (en ? "Payment was not completed" : "Η πληρωμή δεν ολοκληρώθηκε") : (en ? "Confirming payment" : "Επιβεβαίωση πληρωμής")}</h1><p className="mt-4 text-sm leading-6 text-stone-600">{failed ? (en ? "A failed payment may still be retried in Viva. The order status is determined by secure server confirmation, not this return page." : "Μια αποτυχημένη πληρωμή μπορεί να επαναληφθεί στη Viva. Η κατάσταση της παραγγελίας καθορίζεται από ασφαλή επιβεβαίωση του διακομιστή και όχι από αυτή τη σελίδα.") : (en ? "We are waiting for Viva to confirm the transaction. This return page does not mark the order as paid." : "Περιμένουμε τη Viva να επιβεβαιώσει τη συναλλαγή. Αυτή η σελίδα δεν χαρακτηρίζει την παραγγελία ως πληρωμένη.")}</p>{orderNumber ? <Link className="ui-button-primary mt-6" href={`/order/${encodeURIComponent(orderNumber)}${en ? "?lang=en" : ""}`}>{en ? "View order status" : "Προβολή κατάστασης παραγγελίας"}</Link> : <Link className="ui-button-secondary mt-6" href={en ? "/?lang=en" : "/"}>{en ? "Back to store" : "Επιστροφή στο κατάστημα"}</Link>}</div></section>;
}
