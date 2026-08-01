import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { FIXED_PRODUCT_VAT_RATE, isFixedProductVat } from "../lib/product-policy.ts";

test("clothing product VAT is fixed at 24 percent", () => {
  assert.equal(FIXED_PRODUCT_VAT_RATE, 24);
  assert.equal(isFixedProductVat(undefined), true);
  assert.equal(isFixedProductVat(""), true);
  assert.equal(isFixedProductVat("   "), true);
  assert.equal(isFixedProductVat(24), true);
  assert.equal(isFixedProductVat("24"), true);
  assert.equal(isFixedProductVat("24,0"), true);
});

test("non-24 VAT values are rejected", () => {
  assert.equal(isFixedProductVat(23), false);
  assert.equal(isFixedProductVat("13"), false);
  assert.equal(isFixedProductVat("not-a-number"), false);
});
