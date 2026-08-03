import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { CartAvailabilityInputError, parseCartAvailabilityRequest } from "../lib/cart-availability.ts";

test("cart availability requests normalize and deduplicate variant identities", () => {
  const parsed = parseCartAvailabilityRequest(JSON.stringify({
    items: [
      { productSku: " DRESS-001 ", size: "m", color: " Green " },
      { productSku: "dress-001", size: "M", color: "green" },
      { productSku: "DRESS-001", size: "L", color: "Green" },
    ],
  }));
  assert.deepEqual(parsed, [
    { productSku: "DRESS-001", size: "M", color: "Green" },
    { productSku: "DRESS-001", size: "L", color: "Green" },
  ]);
});

test("cart availability requests reject empty, oversized and malformed payloads", () => {
  for (const value of [
    { items: [] },
    { items: [{ productSku: "", size: "M", color: "" }] },
    { items: Array.from({ length: 26 }, (_, index) => ({ productSku: `SKU-${index}`, size: "M", color: "" })) },
  ]) {
    assert.throws(
      () => parseCartAvailabilityRequest(JSON.stringify(value)),
      (error: unknown) => error instanceof CartAvailabilityInputError,
    );
  }
});
