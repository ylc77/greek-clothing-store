import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { createVivaPaymentOrder, getVivaWebhookVerificationKey, retrieveVivaTransaction, verifyVivaConnection, VivaUnavailableError, type VivaConfig } from "../lib/viva.ts";

const config: VivaConfig = {
  apiBaseUrl: "https://demo-api.example.test",
  accountsBaseUrl: "https://demo-accounts.example.test",
  checkoutBaseUrl: "https://demo-checkout.example.test/web/checkout",
  clientId: "test-client",
  clientSecret: "not-a-real-secret",
  sourceCode: "1234",
  merchantId: "merchant-1",
};

test("Viva orderCode stays an opaque decimal string", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body || "") });
    if (String(input).endsWith("/connect/token")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ orderCode: "90071992547409931234" }), { status: 200 });
  };
  const result = await createVivaPaymentOrder({
    amountCents: 4150,
    orderNumber: "WEB-TEST",
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    customerPhone: "+306900000000",
    locale: "en",
  }, { config, fetcher: fetcher as typeof fetch });
  assert.equal(result.orderCode, "90071992547409931234");
  assert.equal(new URL(result.checkoutUrl).searchParams.get("ref"), result.orderCode);
  const paymentBody = JSON.parse(calls[1].body);
  assert.equal(paymentBody.amount, 4150);
  assert.equal(paymentBody.sourceCode, "1234");
});

test("unknown Viva response outcome is retryable and never fabricates success", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    throw new Error("connection reset");
  };
  await assert.rejects(
    createVivaPaymentOrder({
      amountCents: 1500,
      orderNumber: "WEB-TEST",
      customerName: "Test Customer",
      customerEmail: "test@example.com",
      customerPhone: "+306900000000",
      locale: "el",
    }, { config, fetcher: fetcher as typeof fetch }),
    (error: unknown) => error instanceof VivaUnavailableError && error.code === "VIVA_REQUEST_UNKNOWN" && error.retryable,
  );
});

test("invalid and unsafe order codes are rejected", async () => {
  const fetcher = async (input: string | URL | Request) => String(input).endsWith("/connect/token")
    ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
    : new Response(JSON.stringify({ orderCode: "not-a-number" }), { status: 200 });
  await assert.rejects(
    createVivaPaymentOrder({
      amountCents: 1500,
      orderNumber: "WEB-TEST",
      customerName: "Test Customer",
      customerEmail: "test@example.com",
      customerPhone: "+306900000000",
      locale: "el",
    }, { config, fetcher: fetcher as typeof fetch }),
    (error: unknown) => error instanceof VivaUnavailableError && error.code === "VIVA_CREATE_FAILED",
  );
});

test("numeric Viva orderCode is extracted from raw JSON without IEEE-754 rounding", async () => {
  const fetcher = async (input: string | URL | Request) => String(input).endsWith("/connect/token")
    ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
    : new Response('{"orderCode":90071992547409931234}', { status: 200 });
  const result = await createVivaPaymentOrder({
    amountCents: 1500,
    orderNumber: "WEB-TEST",
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    customerPhone: "+306900000000",
    locale: "en",
  }, { config, fetcher: fetcher as typeof fetch });
  assert.equal(result.orderCode, "90071992547409931234");
});

test("Viva transaction verification checks authoritative status, amount and source", async () => {
  const transactionId = "997ab1e3-e6ce-45c9-970d-4d902f27ce71";
  const fetcher = async (input: string | URL | Request) => String(input).endsWith("/connect/token")
    ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
    : new Response('{"amount":41.5,"orderCode":90071992547409931234,"statusId":"F","currencyCode":"978","sourceCode":"1234"}', { status: 200 });
  const result = await retrieveVivaTransaction(transactionId, { config, fetcher: fetcher as typeof fetch });
  assert.deepEqual(result, {
    transactionId,
    orderCode: "90071992547409931234",
    amountCents: 4150,
    currency: "EUR",
    statusId: "F",
    sourceCode: "1234",
  });
});

test("Viva connection verification authenticates without creating a payment", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await verifyVivaConnection({ config, fetcher }), { ok: true });
  assert.deepEqual(calls, ["https://demo-accounts.example.test/connect/token"]);
});

test("Viva webhook verification key fails closed when missing or malformed", () => {
  const original = process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
  try {
    delete process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
    assert.throws(() => getVivaWebhookVerificationKey(), (error: unknown) => error instanceof VivaUnavailableError && error.code === "VIVA_NOT_CONFIGURED");
    process.env.VIVA_WEBHOOK_VERIFICATION_KEY = "invalid\nkey";
    assert.throws(() => getVivaWebhookVerificationKey(), (error: unknown) => error instanceof VivaUnavailableError && error.code === "VIVA_NOT_CONFIGURED");
    process.env.VIVA_WEBHOOK_VERIFICATION_KEY = "test-verification-key";
    assert.equal(getVivaWebhookVerificationKey(), "test-verification-key");
  } finally {
    if (original === undefined) delete process.env.VIVA_WEBHOOK_VERIFICATION_KEY;
    else process.env.VIVA_WEBHOOK_VERIFICATION_KEY = original;
  }
});
