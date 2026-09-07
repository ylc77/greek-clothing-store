import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { parseVivaWebhook, VivaWebhookInputError } from "../lib/viva-webhook.ts";

test("Viva webhook preserves a numeric orderCode beyond the safe integer range", () => {
  const event = parseVivaWebhook('{"EventData":{"Amount":41.5,"OrderCode":90071992547409931234,"StatusId":"F","TransactionId":"997ab1e3-e6ce-45c9-970d-4d902f27ce71","CurrencyCode":"978","SourceCode":"1234","MerchantId":"merchant"},"EventTypeId":1796,"MessageId":"event-1"}');
  assert.equal(event.orderCode, "90071992547409931234");
  assert.equal(event.amountCents, 4150);
  assert.equal(event.eventType, "transaction_payment_created");
});

test("unsupported or malformed webhook events fail closed", () => {
  assert.throws(() => parseVivaWebhook("{}"), (error: unknown) => error instanceof VivaWebhookInputError);
  assert.throws(() => parseVivaWebhook(JSON.stringify({ EventData: {}, EventTypeId: 1 })), (error: unknown) => error instanceof VivaWebhookInputError);
});
