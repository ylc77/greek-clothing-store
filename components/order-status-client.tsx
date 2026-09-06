"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";

type OrderItem = { product_sku: string; name_en: string; name_gr: string; size: string; color: string; quantity: number; line_total: number };
type PublicOrder = {
  order_number: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  fulfillment_method: "box_now" | "store_pickup" | string;
  total: number;
  boxnow_locker_name?: string | null;
  boxnow_locker_address?: string | null;
  boxnow_locker_postal_code?: string | null;
  pickup_code?: string | null;
  pickup_expires_at?: string | null;
  items: OrderItem[];
};

export function OrderStatusClient({ orderNumber, language }: { orderNumber: string; language: Language }) {
  const en = language === "en";
  const [data, setData] = useState<PublicOrder | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const token = window.localStorage.getItem(`clothing-store:order-access:${orderNumber}`) || "";
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`, { headers: { "x-order-access-token": token }, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Order unavailable");
        if (stopped) return;
        setData(body.order as PublicOrder);
        setError("");
        if (["pending", "payment_order_created", "awaiting_confirmation"].includes(String(body.order?.payment_status))) timer = setTimeout(load, 3000);
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Order unavailable");
      }
    };
    void load();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [orderNumber]);

  if (error) return <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">{error}</div>;
  if (!data) return <div className="py-12 text-center text-stone-500">{en ? "Confirming payment…" : "Επιβεβαίωση πληρωμής…"}</div>;
  const labels: Record<string, string> = en ? {
    pending_payment: "Waiting for payment", paid: "Paid", packing: "Being prepared", ready_for_pickup: "Ready for pickup", shipped: "Sent with BOX NOW", completed: "Completed", cancelled: "Cancelled", refunded: "Refunded",
  } : {
    pending_payment: "Αναμονή πληρωμής", paid: "Πληρωμένη", packing: "Σε προετοιμασία", ready_for_pickup: "Έτοιμη για παραλαβή", shipped: "Απεστάλη με BOX NOW", completed: "Ολοκληρώθηκε", cancelled: "Ακυρώθηκε", refunded: "Επιστράφηκε",
  };
  const paymentPending = data.payment_status !== "paid";
  const pickupOverdue = data.fulfillment_status === "pickup_overdue";
  return <div className="rounded-3xl border border-stone-200 bg-white p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-stone-400">{orderNumber}</p><h1 className="mt-2 text-3xl font-black">{paymentPending ? (en ? "Confirming your payment" : "Επιβεβαίωση πληρωμής") : (en ? "Thank you for your order" : "Ευχαριστούμε για την παραγγελία")}</h1></div><span className="rounded-full bg-stone-100 px-4 py-2 text-sm font-black">{pickupOverdue ? (en ? "Pickup overdue" : "Εκπρόθεσμη παραλαβή") : (labels[data.status] || data.status)}</span></div>{paymentPending ? <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{en ? "Viva is still confirming the payment. Do not place the same order again. This page will update automatically." : "Η Viva επιβεβαιώνει ακόμη την πληρωμή. Μην υποβάλετε ξανά την ίδια παραγγελία. Η σελίδα θα ενημερωθεί αυτόματα."}</p> : null}{pickupOverdue ? <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{en ? "The pickup holding period has passed. Contact the store before travelling. The order has not been cancelled or refunded automatically." : "Η περίοδος φύλαξης έχει λήξει. Επικοινωνήστε με το κατάστημα πριν μεταβείτε. Η παραγγελία δεν ακυρώθηκε ούτε επιστράφηκε αυτόματα."}</p> : null}<div className="mt-6 space-y-3 border-t pt-5">{data.items.map(item => <div className="flex justify-between gap-4 text-sm" key={`${item.product_sku}-${item.size}-${item.color}`}><span>{item.quantity}× {en ? item.name_en : item.name_gr} · {item.size}{item.color ? ` · ${item.color}` : ""}</span><b>€{Number(item.line_total).toFixed(2)}</b></div>)}</div><div className="mt-6 flex justify-between border-t pt-5 text-xl font-black"><span>{en ? "Total" : "Σύνολο"}</span><span>€{Number(data.total).toFixed(2)}</span></div>{data.fulfillment_method === "box_now" ? <p className="mt-4 text-sm leading-6 text-stone-500">{en ? "BOX NOW Locker" : "BOX NOW Locker"}: <b>{data.boxnow_locker_name}</b>{data.boxnow_locker_address ? ` · ${data.boxnow_locker_address}` : ""}</p> : <p className="mt-4 text-sm leading-6 text-stone-500">{en ? "The store will notify you when your paid order is ready for pickup." : "Το κατάστημα θα σας ενημερώσει όταν η πληρωμένη παραγγελία σας είναι έτοιμη για παραλαβή."}{data.pickup_code ? <><br /><b>{en ? "Pickup code" : "Κωδικός παραλαβής"}: {data.pickup_code}</b></> : null}</p>}<Link className="ui-button-secondary mt-6" href={en ? "/?lang=en" : "/"}>{en ? "Continue shopping" : "Συνέχεια αγορών"}</Link></div>;
}
