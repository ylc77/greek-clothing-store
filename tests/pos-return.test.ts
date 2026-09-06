import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { calculateReturnExchangeAmounts, parsePosReturnExchangeInput } from "../lib/pos-return.ts";

const orderItemId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";

test("return parser rejects invalid quantities and conflicting duplicate conditions", () => {
  assert.throws(() => parsePosReturnExchangeInput({ clientRequestId: "x", reason: "退货", returnItems: [{ orderItemId, quantity: 0, condition: "resellable" }], exchangeItems: [], externalConfirmation: { expectedBalanceDelta: 0 } }));
  assert.throws(() => parsePosReturnExchangeInput({ clientRequestId: "x", reason: "退货原因", returnItems: [{ orderItemId, quantity: 1, condition: "resellable" }, { orderItemId, quantity: 1, condition: "damaged" }], exchangeItems: [], externalConfirmation: { expectedBalanceDelta: 0 } }));
});

test("return parser merges duplicate exchange variants without accepting barcode or price", () => {
  const parsed = parsePosReturnExchangeInput({
    clientRequestId: "operation-1", reason: "顾客换码", returnItems: [{ orderItemId, quantity: 1, condition: "resellable" }],
    exchangeItems: [{ variantId, quantity: 1, barcode: "ignored", price: 0 }, { variantId, quantity: 2 }],
    externalConfirmation: { expectedBalanceDelta: 0, confirmed: false },
  });
  assert.deepEqual(parsed.exchangeItems, [{ variantId, quantity: 3 }]);
  assert.equal("barcode" in parsed.exchangeItems[0], false);
});

test("amount calculation preserves final rounding remainder and computes difference", () => {
  assert.deepEqual(calculateReturnExchangeAmounts([
    { lineTotal: 10, soldQuantity: 3, previousQuantity: 2, previousAmount: 6.66, quantity: 1 },
  ], [{ unitPrice: 5, quantity: 1 }]), { returnSubtotal: 3.34, exchangeSubtotal: 5, balanceDelta: 1.66 });
});
