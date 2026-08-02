import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { addCartItem, cartItemKey, cartTotals, normalizeCart, updateCartQuantity } from "../lib/cart.ts";

const item = (overrides = {}) => ({
  productSku: "DRESS-001",
  nameEn: "Summer dress",
  nameGr: "Καλοκαιρινό φόρεμα",
  size: "M",
  color: "Green",
  quantity: 1,
  availableQuantity: 4,
  unitPrice: 29.9,
  imageUrl: "/dress.webp",
  ...overrides,
});

test("cart groups the same product variant and respects available stock", () => {
  const result = normalizeCart([item({ quantity: 3 }), item({ quantity: 3 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 4);
});

test("cart keeps different size and color variants separate", () => {
  const result = normalizeCart([item(), item({ size: "L" }), item({ color: "Black" })]);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map(cartItemKey)).size, 3);
});

test("adding and editing quantities cannot exceed stock or line limits", () => {
  const added = addCartItem([item({ quantity: 3 })], item({ quantity: 3 }));
  assert.equal(added[0].quantity, 4);
  const updated = updateCartQuantity(added, cartItemKey(added[0]), 99);
  assert.equal(updated[0].quantity, 4);
  assert.deepEqual(updateCartQuantity(updated, cartItemKey(updated[0]), 0), []);
});

test("cart totals count units separately from lines", () => {
  assert.deepEqual(cartTotals([item({ quantity: 2 }), item({ size: "L", quantity: 1, unitPrice: 20 })]), {
    lines: 2,
    quantity: 3,
    subtotal: 79.8,
  });
});

test("invalid, sold-out and excessive cart values are rejected", () => {
  assert.deepEqual(normalizeCart([item({ availableQuantity: 0 }), item({ quantity: 21 }), null]), []);
});
