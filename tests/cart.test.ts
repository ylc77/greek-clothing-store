import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { addCartItem, applyCartAvailability, cartItemKey, cartTotals, normalizeCart, tryAddCartItem, updateCartQuantity } from "../lib/cart.ts";

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

test("adding beyond available stock returns an explicit limit result instead of silently reporting success", () => {
  const result = tryAddCartItem([item({ quantity: 3 })], item({ quantity: 2 }));
  assert.equal(result.status, "stock_limit");
  assert.equal(result.availableToAdd, 1);
  assert.equal(result.items[0].quantity, 3);
});

test("authoritative availability refresh keeps sold-out lines visible and adjusts excessive quantities", () => {
  const result = applyCartAvailability(
    [item({ quantity: 4 }), item({ size: "L", quantity: 2, availableQuantity: 3 })],
    [
      { productSku: "DRESS-001", size: "M", color: "Green", availableQuantity: 2, unitPrice: 31.5 },
      { productSku: "DRESS-001", size: "L", color: "Green", availableQuantity: 0, unitPrice: 29.9 },
    ],
  );
  assert.equal(result.adjustedLines, 1);
  assert.equal(result.unavailableLines, 1);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].availableQuantity, 2);
  assert.equal(result.items[0].unitPrice, 31.5);
  assert.equal(result.items[1].quantity, 2);
  assert.equal(result.items[1].availableQuantity, 0);
});

test("cart totals count units separately from lines", () => {
  assert.deepEqual(cartTotals([item({ quantity: 2 }), item({ size: "L", quantity: 1, unitPrice: 20 })]), {
    lines: 2,
    quantity: 3,
    subtotal: 79.8,
  });
});

test("invalid and excessive cart values are rejected while sold-out lines remain visible for correction", () => {
  const result = normalizeCart([item({ availableQuantity: 0 }), item({ quantity: 21 }), null]);
  assert.equal(result.length, 1);
  assert.equal(result[0].availableQuantity, 0);
});
