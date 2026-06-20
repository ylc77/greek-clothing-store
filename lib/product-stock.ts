/**
 * Unified size-stock logic — the single source of truth for:
 * - hasSizeStock(product)  – does the product have size_stock data?
 * - getTotalStock(product) – effective total stock (size_stock sum or old stock)
 * - getSizeOptions(product) – array of { label, stock, disabled } for UI rendering
 *
 * Every consumer (product page, product card, product actions, admin list,
 * feed.xml) MUST use these functions.  Do NOT inline re-derive the logic.
 */

import type { Product } from "@/lib/types";

export interface SizeOption {
  label: string;
  stock: number;
  disabled: boolean;
}

/**
 * Does the product have a non-empty size_stock object?
 * Even if all values are 0, this MUST return true.
 */
export function hasSizeStock(product: {
  size_stock?: Record<string, number> | null;
}): boolean {
  const ss = (product as Record<string, unknown>).size_stock;
  if (!ss || typeof ss !== "object" || Array.isArray(ss)) return false;
  return Object.keys(ss).length > 0;
}

/**
 * Effective total stock.
 * If size_stock exists → sum of all entries.
 * Otherwise → product.stock (old data).
 */
export function getTotalStock(product: {
  stock: number;
  size_stock?: Record<string, number> | null;
}): number {
  if (hasSizeStock(product)) {
    const ss = (product as Record<string, unknown>).size_stock as Record<
      string,
      number
    >;
    return Object.values(ss).reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
  }
  return Number(product.stock) || 0;
}

/**
 * Size options for UI rendering (size picker buttons).
 *
 * If size_stock exists → each entry mapped to { label, stock, disabled }.
 *   stock = entry value (0 → disabled=true).
 * If size_stock does NOT exist → fall back to old sizes string + stock.
 *   stock > 0 → all sizes available (disabled=false, stock=-1).
 *   stock ≤ 0 → all sizes disabled.
 */
export function getSizeOptions(product: {
  sizes: string | null;
  stock: number;
  size_stock?: Record<string, number> | null;
}): SizeOption[] {
  if (hasSizeStock(product)) {
    const ss = (product as Record<string, unknown>).size_stock as Record<
      string,
      number
    >;
    return Object.entries(ss).map(([k, v]) => {
      const qty = typeof v === "number" && v > 0 ? v : 0;
      return { label: k, stock: qty, disabled: qty === 0 };
    });
  }

  // Fallback: old data (sizes string + stock number)
  const labels = Array.from(
    new Set(
      (product.sizes || "")
        .split(/[\/,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  const stockNum = Number(product.stock) || 0;
  return labels.map((label) => ({
    label,
    stock: -1, // unknown — treat as available if stock > 0
    disabled: stockNum <= 0,
  }));
}
