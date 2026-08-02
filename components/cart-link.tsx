"use client";

import Link from "next/link";
import { useCart } from "@/components/cart-provider";
import type { Language } from "@/lib/i18n";

export function CartLink({ language }: { language: Language }) {
  const { totals, ready } = useCart();
  return (
    <Link aria-label={language === "en" ? "Shopping cart" : "Καλάθι αγορών"} className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-white text-ink shadow-sm transition hover:border-stone-400" href={language === "en" ? "/cart?lang=en" : "/cart"}>
      <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3h2l2.2 10.2a2 2 0 002 1.6h7.7a2 2 0 002-1.6L20.5 7H6"/><circle cx="10" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>
      {ready && totals.quantity > 0 ? <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-terracotta px-1 text-[10px] font-black text-white">{Math.min(totals.quantity, 99)}</span> : null}
    </Link>
  );
}
