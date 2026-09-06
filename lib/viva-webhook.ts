import { createHash } from "node:crypto";

export type VivaWebhookEvent = {
  eventId: string;
  eventTypeId: number;
  eventType: string;
  orderCode: string;
  transactionId: string;
  amountCents: number;
  currency: "EUR";
  statusId: string;
  sourceCode: string;
  merchantId: string;
  payloadDigest: string;
};

export class VivaWebhookInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function parseVivaWebhook(raw: string): VivaWebhookEvent {
  if (Buffer.byteLength(raw, "utf8") > 64_000) throw new VivaWebhookInputError("PAYLOAD_TOO_LARGE", "Webhook payload is too large.");
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new VivaWebhookInputError("INVALID_JSON", "Webhook payload is invalid."); }
  const eventData = body.EventData && typeof body.EventData === "object" && !Array.isArray(body.EventData)
    ? body.EventData as Record<string, unknown>
    : null;
  if (!eventData) throw new VivaWebhookInputError("INVALID_EVENT", "Webhook event data is missing.");
  const eventTypeId = Math.trunc(Number(body.EventTypeId));
  const rawEventData = raw.match(/"EventData"\s*:\s*\{([\s\S]*?)\}\s*,\s*"(?:Created|CorrelationId|EventTypeId|Delay|RetryCount|MessageId)"/i)?.[1] || raw;
  const orderCode = rawEventData.match(/"OrderCode"\s*:\s*"?(\d{1,64})"?/i)?.[1] || "";
  const transactionId = String(eventData.TransactionId || "").trim();
  const amount = Number(eventData.Amount);
  const currencyCode = String(eventData.CurrencyCode || "");
  const statusId = String(eventData.StatusId || "").trim();
  const messageId = String(body.MessageId || "").trim();
  const payloadDigest = createHash("sha256").update(raw).digest("hex");
  if (![1796, 1797, 1798].includes(eventTypeId) || !orderCode || !/^[0-9a-f-]{36}$/i.test(transactionId) || !Number.isFinite(amount) || amount < 0 || currencyCode !== "978" || !statusId) {
    throw new VivaWebhookInputError("INVALID_EVENT", "Webhook event is invalid.");
  }
  return {
    eventId: messageId || payloadDigest,
    eventTypeId,
    eventType: eventTypeId === 1796 ? "transaction_payment_created" : eventTypeId === 1797 ? "transaction_reversal_created" : "transaction_failed",
    orderCode,
    transactionId,
    amountCents: Math.round(Math.abs(amount) * 100),
    currency: "EUR",
    statusId,
    sourceCode: String(eventData.SourceCode || "").trim(),
    merchantId: String(eventData.MerchantId || "").trim(),
    payloadDigest,
  };
}
