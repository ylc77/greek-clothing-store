"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CART_STORAGE_KEY, addCartItem, cartItemKey, cartTotals, normalizeCart, updateCartQuantity, type CartItem } from "@/lib/cart";

type CartContextValue = {
  items: CartItem[];
  ready: boolean;
  totals: ReturnType<typeof cartTotals>;
  addItem: (item: CartItem) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { setItems(normalizeCart(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || "[]"))); } catch { setItems([]); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)); } catch { /* in-memory cart remains usable */ }
  }, [items, ready]);

  const addItem = useCallback((item: CartItem) => setItems(current => addCartItem(current, item)), []);
  const setQuantity = useCallback((key: string, quantity: number) => setItems(current => updateCartQuantity(current, key, quantity)), []);
  const removeItem = useCallback((key: string) => setItems(current => current.filter(item => cartItemKey(item) !== key)), []);
  const clear = useCallback(() => setItems([]), []);
  const value = useMemo(() => ({ items, ready, totals: cartTotals(items), addItem, setQuantity, removeItem, clear }), [addItem, clear, items, ready, removeItem, setQuantity]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider");
  return value;
}
