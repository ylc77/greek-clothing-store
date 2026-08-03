"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CART_STORAGE_KEY,
  applyCartAvailability,
  cartItemKey,
  cartTotals,
  normalizeCart,
  tryAddCartItem,
  updateCartQuantity,
  type CartAddResult,
  type CartAvailabilityResult,
  type CartAvailabilitySnapshot,
  type CartItem,
} from "@/lib/cart";

export type CartAvailabilityState = "idle" | "checking" | "ready" | "error";
export type CartAvailabilityRefreshResult = CartAvailabilityResult & { ok: boolean };

type CartContextValue = {
  items: CartItem[];
  ready: boolean;
  availabilityState: CartAvailabilityState;
  totals: ReturnType<typeof cartTotals>;
  addItem: (item: CartItem) => CartAddResult;
  setQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  refreshAvailability: () => Promise<CartAvailabilityRefreshResult>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [availabilityState, setAvailabilityState] = useState<CartAvailabilityState>("idle");
  const itemsRef = useRef<CartItem[]>([]);

  const commitItems = useCallback((next: CartItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    try { commitItems(normalizeCart(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || "[]"))); } catch { commitItems([]); }
    setReady(true);
  }, [commitItems]);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)); } catch { /* in-memory cart remains usable */ }
  }, [items, ready]);

  const addItem = useCallback((item: CartItem) => {
    const result = tryAddCartItem(itemsRef.current, item);
    if (result.status === "added") commitItems(result.items);
    return result;
  }, [commitItems]);
  const setQuantity = useCallback((key: string, quantity: number) => {
    commitItems(updateCartQuantity(itemsRef.current, key, quantity));
  }, [commitItems]);
  const removeItem = useCallback((key: string) => {
    commitItems(itemsRef.current.filter(item => cartItemKey(item) !== key));
  }, [commitItems]);
  const clear = useCallback(() => {
    commitItems([]);
    setAvailabilityState("idle");
  }, [commitItems]);
  const refreshAvailability = useCallback(async (): Promise<CartAvailabilityRefreshResult> => {
    const current = itemsRef.current;
    if (current.length === 0) {
      setAvailabilityState("ready");
      return { ok: true, items: current, adjustedLines: 0, unavailableLines: 0 };
    }
    setAvailabilityState("checking");
    try {
      const response = await fetch("/api/cart/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: current.map(item => ({ productSku: item.productSku, size: item.size, color: item.color })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.items)) throw new Error("AVAILABILITY_UNAVAILABLE");
      const latest = itemsRef.current;
      const requestedKeys = current.map(cartItemKey).sort().join("\u0000");
      const latestKeys = latest.map(cartItemKey).sort().join("\u0000");
      if (requestedKeys !== latestKeys) throw new Error("CART_CHANGED_DURING_AVAILABILITY_CHECK");
      const result = applyCartAvailability(latest, data.items as CartAvailabilitySnapshot[]);
      commitItems(result.items);
      setAvailabilityState("ready");
      return { ok: true, ...result };
    } catch {
      setAvailabilityState("error");
      return { ok: false, items: current, adjustedLines: 0, unavailableLines: 0 };
    }
  }, [commitItems]);
  const value = useMemo(() => ({
    items,
    ready,
    availabilityState,
    totals: cartTotals(items),
    addItem,
    setQuantity,
    removeItem,
    clear,
    refreshAvailability,
  }), [addItem, availabilityState, clear, items, ready, refreshAvailability, removeItem, setQuantity]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider");
  return value;
}
