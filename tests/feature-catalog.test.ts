import assert from "node:assert/strict";
import test from "node:test";
import {
  featureKeys,
  featurePlanPresets,
  normalizeFeatureFlags,
  toggleFeatureWithDependencies,
} from "../lib/feature-catalog.ts";

test("basic plan fails closed for premium features", () => {
  const basic = featurePlanPresets.basic;
  assert.equal(basic.storefront, true);
  assert.equal(basic.product_management, true);
  assert.equal(basic.inventory, true);
  for (const key of ["pos_checkout", "pos_orders", "pos_void", "pos_reports", "staff_accounts", "skroutz_feed", "ai_tools"] as const) {
    assert.equal(basic[key], false, `${key} must be disabled in Basic`);
  }
});

test("standard and advanced presets preserve dependency requirements", () => {
  const standard = featurePlanPresets.standard;
  assert.equal(standard.pos_checkout, true);
  assert.equal(standard.pos_orders, true);
  assert.equal(standard.pos_void, true);
  assert.equal(standard.staff_accounts, true);
  assert.equal(standard.ai_tools, false);
  assert.equal(standard.skroutz_feed, false);
  assert.ok(featureKeys.every((key) => featurePlanPresets.advanced[key]));
});

test("missing or invalid feature data falls back to the safe Basic preset", () => {
  const normalized = normalizeFeatureFlags({ pos_checkout: "yes", ai_tools: null });
  assert.deepEqual(normalized, featurePlanPresets.basic);
});

test("disabling a dependency also disables every dependent feature", () => {
  const withoutCheckout = toggleFeatureWithDependencies(featurePlanPresets.standard, "pos_checkout");
  assert.equal(withoutCheckout.pos_checkout, false);
  assert.equal(withoutCheckout.pos_orders, false);
  assert.equal(withoutCheckout.pos_void, false);
  assert.equal(withoutCheckout.pos_reports, false);
  assert.equal(withoutCheckout.receipt_printing, false);
});

test("always-on core features cannot be disabled", () => {
  for (const key of ["storefront", "product_management", "inventory"] as const) {
    const toggled = toggleFeatureWithDependencies(featurePlanPresets.basic, key);
    assert.equal(toggled[key], true);
  }
});
