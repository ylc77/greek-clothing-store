import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { parseInventoryReceiptInput, receiptRequestFingerprint } from "../lib/inventory-receipt.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("receipt input deduplicates Variants and sums the received quantity", () => {
  const parsed = parseInventoryReceiptInput({
    clientRequestId: " receive-1 ",
    supplierReference: " INV-8 ",
    items: [
      { variantId: B, quantity: 3, unitCost: 4.5 },
      { variantId: A, quantity: 2 },
      { variantId: B, quantity: 2, unitCost: 4.5 },
    ],
  });
  assert.equal(parsed.clientRequestId, "receive-1");
  assert.deepEqual(parsed.items, [
    { variantId: A, quantity: 2, unitCost: null },
    { variantId: B, quantity: 5, unitCost: 4.5 },
  ]);
});

test("receipt input rejects empty, invalid, excessive, and conflicting rows", () => {
  assert.throws(() => parseInventoryReceiptInput({ clientRequestId: "x", items: [] }), /1 to 100/);
  assert.throws(() => parseInventoryReceiptInput({ clientRequestId: "x", items: [{ variantId: A, quantity: 0 }] }), /positive integer/);
  assert.throws(() => parseInventoryReceiptInput({ clientRequestId: "x", items: [{ variantId: "bad", quantity: 1 }] }), /UUID/);
  assert.throws(() => parseInventoryReceiptInput({ clientRequestId: "x", items: [
    { variantId: A, quantity: 1, unitCost: 1 },
    { variantId: A, quantity: 1, unitCost: 2 },
  ] }), /same unit cost/);
});

test("receipt fingerprint is stable across input ordering and duplicate aggregation", () => {
  const first = parseInventoryReceiptInput({ clientRequestId: "a", items: [
    { variantId: A, quantity: 1 }, { variantId: B, quantity: 2 }, { variantId: A, quantity: 2 },
  ] });
  const replay = parseInventoryReceiptInput({ clientRequestId: "a", items: [
    { variantId: B, quantity: 2 }, { variantId: A, quantity: 3 },
  ] });
  assert.equal(receiptRequestFingerprint(first), receiptRequestFingerprint(replay));
});
