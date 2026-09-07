import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { calculateFulfillmentOptions, centsToEuros, eurosToCents, parseFulfillmentQuoteRequest } from "../lib/fulfillment.ts";

const settings = {
  boxNowEnabled: true,
  storePickupEnabled: true,
  boxNowMinimumSubtotalCents: 1500,
  boxNowShippingFeeCents: 250,
  boxNowFreeShippingThresholdCents: 3900,
  boxNowMaxWeightGrams: 20_000,
  boxNowMaxLengthMm: 600,
  boxNowMaxWidthMm: 450,
  boxNowMaxHeightMm: 360,
};

function cart(totalCents: number, profile: "boxnow_and_pickup" | "pickup_only" = "boxnow_and_pickup") {
  return [{ productSku: "TEST-1", quantity: 1, unitPriceCents: totalCents, fulfillmentProfile: profile }];
}

test("BOX NOW thresholds use merchandise subtotal only", () => {
  const low = calculateFulfillmentOptions(cart(1000), settings);
  assert.equal(low.boxNow.available, false);
  assert.equal(low.boxNow.reason, "minimum_not_met");
  assert.equal(low.boxNow.amountMissingCents, 500);

  const minimum = calculateFulfillmentOptions(cart(1500), settings);
  assert.equal(minimum.boxNow.available, true);
  assert.equal(minimum.boxNow.feeCents, 250);

  const belowFree = calculateFulfillmentOptions(cart(3899), settings);
  assert.equal(belowFree.boxNow.feeCents, 250);

  const free = calculateFulfillmentOptions(cart(3900), settings);
  assert.equal(free.boxNow.feeCents, 0);
});

test("a pickup-only item forces the entire cart to store pickup", () => {
  const quote = calculateFulfillmentOptions([
    ...cart(2000),
    ...cart(3000, "pickup_only"),
  ], settings);
  assert.equal(quote.containsPickupOnly, true);
  assert.equal(quote.boxNow.available, false);
  assert.equal(quote.boxNow.reason, "pickup_only_item");
  assert.equal(quote.storePickup.available, true);
  assert.equal(quote.storePickup.feeCents, 0);
});

test("disabled fulfillment methods fail closed", () => {
  const quote = calculateFulfillmentOptions(cart(4000), {
    ...settings,
    boxNowEnabled: false,
    storePickupEnabled: false,
  });
  assert.equal(quote.boxNow.available, false);
  assert.equal(quote.boxNow.reason, "disabled");
  assert.equal(quote.storePickup.available, false);
  assert.equal(quote.storePickup.reason, "disabled");
});

test("known BOX NOW package weight and dimensions are enforced", () => {
  const overweight = calculateFulfillmentOptions([{
    ...cart(4000)[0],
    quantity: 3,
    packageWeightGrams: 7000,
  }], settings);
  assert.equal(overweight.boxNow.available, false);
  assert.equal(overweight.boxNow.reason, "package_limit");
  assert.equal(overweight.storePickup.available, true);

  const oversized = calculateFulfillmentOptions([{
    ...cart(4000)[0],
    packageLengthMm: 601,
    packageWidthMm: 200,
    packageHeightMm: 100,
  }], settings);
  assert.equal(oversized.boxNow.available, false);
  assert.equal(oversized.boxNow.reason, "package_limit");
});

test("missing optional package measurements do not block BOX NOW", () => {
  const quote = calculateFulfillmentOptions(cart(4000), settings);
  assert.equal(quote.boxNow.available, true);
  assert.equal(quote.boxNow.reason, null);
});

test("EUR conversion rounds only at the provider boundary", () => {
  assert.equal(eurosToCents(2.5), 250);
  assert.equal(eurosToCents(38.999), 3900);
  assert.equal(centsToEuros(250), 2.5);
});

test("invalid or unsafe amounts are rejected", () => {
  assert.throws(() => calculateFulfillmentOptions(cart(-1), settings));
  assert.throws(() => calculateFulfillmentOptions([], settings));
  assert.throws(() => eurosToCents(Number.POSITIVE_INFINITY));
});

test("quote requests normalize duplicate Variant identities and quantities", () => {
  assert.deepEqual(parseFulfillmentQuoteRequest(JSON.stringify({ items: [
    { productSku: " DRESS-1 ", size: "m", color: "Blue", quantity: 1 },
    { productSku: "dress-1", size: "M", color: "blue", quantity: 2 },
  ] })), [{ productSku: "DRESS-1", size: "M", color: "Blue", quantity: 3 }]);
});

test("quote requests reject missing and excessive quantities", () => {
  assert.throws(() => parseFulfillmentQuoteRequest(JSON.stringify({ items: [] })));
  assert.throws(() => parseFulfillmentQuoteRequest(JSON.stringify({ items: [
    { productSku: "DRESS-1", size: "M", color: "", quantity: 21 },
  ] })));
});
