import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { OnlineOrderInputError, onlineOrderFingerprintPayload, parseOnlineOrderRequest } from "../lib/online-order.ts";

const token = () => randomBytes(32).toString("base64url");
const request = (overrides = {}) => ({
  operationId: randomUUID(),
  accessToken: token(),
  fulfillmentMethod: "delivery",
  customer: {
    name: "Test Customer",
    email: "TEST@example.com",
    phone: "+30 6900000000",
    addressLine1: "1 Test Street",
    city: "Athens",
    postalCode: "10558",
    notes: "",
  },
  items: [{ productSku: "DRESS-001", size: "m", color: "Green", quantity: 1 }],
  locale: "en",
  legalAccepted: true,
  ...overrides,
});

function rejectsCode(value: unknown, code: string) {
  assert.throws(
    () => parseOnlineOrderRequest(JSON.stringify(value)),
    (error: unknown) => error instanceof OnlineOrderInputError && error.code === code,
  );
}

test("delivery orders are normalized and duplicate variants are grouped", () => {
  const parsed = parseOnlineOrderRequest(JSON.stringify(request({
    items: [
      { productSku: "DRESS-001", size: "m", color: "Green", quantity: 1 },
      { productSku: "DRESS-001", size: "M", color: "green", quantity: 2 },
    ],
  })));
  assert.equal(parsed.customer.email, "test@example.com");
  assert.deepEqual(parsed.items, [{ productSku: "DRESS-001", size: "M", color: "green", quantity: 3 }]);
});

test("pickup orders do not require a delivery address", () => {
  const value = request({
    fulfillmentMethod: "pickup",
    customer: { name: "Test Customer", email: "test@example.com", phone: "6900000000", addressLine1: "", city: "", postalCode: "", notes: "" },
  });
  assert.equal(parseOnlineOrderRequest(JSON.stringify(value)).fulfillmentMethod, "pickup");
});

test("delivery address, legal consent and quantity constraints fail closed", () => {
  rejectsCode(request({ customer: { ...request().customer, addressLine1: "" } }), "DELIVERY_ADDRESS_REQUIRED");
  rejectsCode(request({ legalAccepted: false }), "LEGAL_ACCEPTANCE_REQUIRED");
  rejectsCode(request({ items: [{ productSku: "DRESS-001", size: "M", color: "", quantity: 21 }] }), "INVALID_ITEMS");
});

test("operation identity and access token must be valid", () => {
  rejectsCode(request({ operationId: "not-a-uuid" }), "INVALID_OPERATION_ID");
  rejectsCode(request({ accessToken: "short" }), "INVALID_ACCESS_TOKEN");
});

test("fingerprint excludes retry credentials but changes with business payload", () => {
  const first = parseOnlineOrderRequest(JSON.stringify(request()));
  const replay = { ...first, operationId: randomUUID(), accessToken: token() };
  assert.equal(onlineOrderFingerprintPayload(first), onlineOrderFingerprintPayload(replay));
  assert.notEqual(onlineOrderFingerprintPayload(first), onlineOrderFingerprintPayload({ ...replay, fulfillmentMethod: "pickup" }));
});
