export type VivaConfig = {
  apiBaseUrl: string;
  accountsBaseUrl: string;
  checkoutBaseUrl: string;
  clientId: string;
  clientSecret: string;
  sourceCode: string;
  merchantId: string;
};

export type VivaPaymentOrderInput = {
  amountCents: number;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  locale: "el" | "en";
};

export type VivaPaymentOrderResult = {
  orderCode: string;
  checkoutUrl: string;
};

export function vivaCheckoutUrl(config: VivaConfig, orderCode: string) {
  if (!/^[0-9]{1,64}$/.test(orderCode)) {
    throw new VivaUnavailableError("VIVA_ORDER_CODE_INVALID", "Viva order code is invalid.");
  }
  const checkout = new URL(config.checkoutBaseUrl);
  checkout.searchParams.set("ref", orderCode);
  return checkout.toString();
}

export class VivaUnavailableError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new VivaUnavailableError("VIVA_NOT_CONFIGURED", "Viva Smart Checkout is not configured.");
  return value;
}

function httpsBase(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new VivaUnavailableError("VIVA_NOT_CONFIGURED", `${name} is invalid.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new VivaUnavailableError("VIVA_NOT_CONFIGURED", `${name} is invalid.`);
  }
  return url.toString().replace(/\/$/, "");
}

export function getVivaConfig(): VivaConfig {
  return {
    apiBaseUrl: httpsBase(required("VIVA_API_BASE_URL"), "VIVA_API_BASE_URL"),
    accountsBaseUrl: httpsBase(required("VIVA_ACCOUNTS_BASE_URL"), "VIVA_ACCOUNTS_BASE_URL"),
    checkoutBaseUrl: httpsBase(required("VIVA_CHECKOUT_BASE_URL"), "VIVA_CHECKOUT_BASE_URL"),
    clientId: required("VIVA_CLIENT_ID"),
    clientSecret: required("VIVA_CLIENT_SECRET"),
    sourceCode: required("VIVA_SOURCE_CODE"),
    merchantId: required("VIVA_MERCHANT_ID"),
  };
}

export function getVivaWebhookVerificationKey() {
  const value = required("VIVA_WEBHOOK_VERIFICATION_KEY");
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new VivaUnavailableError("VIVA_NOT_CONFIGURED", "Viva webhook verification is invalid.");
  }
  return value;
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (text.length > 64_000) throw new VivaUnavailableError("VIVA_RESPONSE_INVALID", "Viva returned an oversized response.", true);
  try {
    return { body: text ? JSON.parse(text) as Record<string, unknown> : {}, raw: text };
  } catch {
    throw new VivaUnavailableError("VIVA_RESPONSE_INVALID", "Viva returned an invalid response.", true);
  }
}

async function fetchWithTimeout(fetcher: typeof fetch, input: string, init: RequestInit, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal, cache: "no-store" });
  } catch {
    throw new VivaUnavailableError("VIVA_REQUEST_UNKNOWN", "Viva request outcome is unknown.", true);
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken(config: VivaConfig, fetcher: typeof fetch) {
  const authorization = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const response = await fetchWithTimeout(fetcher, `${config.accountsBaseUrl}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const { body } = await responseJson(response);
  const token = typeof body.access_token === "string" ? body.access_token : "";
  if (!response.ok || !token) {
    throw new VivaUnavailableError("VIVA_AUTH_FAILED", "Viva authentication failed.", response.status === 429 || response.status >= 500);
  }
  return token;
}

export async function verifyVivaConnection(
  options: { config?: VivaConfig; fetcher?: typeof fetch } = {},
) {
  const config = options.config || getVivaConfig();
  await getAccessToken(config, options.fetcher || fetch);
  return { ok: true as const };
}

export async function createVivaPaymentOrder(
  input: VivaPaymentOrderInput,
  options: { config?: VivaConfig; fetcher?: typeof fetch } = {},
): Promise<VivaPaymentOrderResult> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) {
    throw new VivaUnavailableError("VIVA_AMOUNT_INVALID", "Payment amount is invalid.");
  }
  const config = options.config || getVivaConfig();
  const fetcher = options.fetcher || fetch;
  const token = await getAccessToken(config, fetcher);
  const response = await fetchWithTimeout(fetcher, `${config.apiBaseUrl}/checkout/v2/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountCents,
      sourceCode: config.sourceCode,
      customerTrns: input.locale === "en" ? `Order ${input.orderNumber}` : `Παραγγελία ${input.orderNumber}`,
      merchantTrns: input.orderNumber,
      customer: {
        email: input.customerEmail,
        fullName: input.customerName,
        phone: input.customerPhone,
        countryCode: "GR",
        requestLang: input.locale,
      },
    }),
  });
  const { body, raw } = await responseJson(response);
  const rawOrderCode = raw.match(/"orderCode"\s*:\s*"?(\d{1,64})"?/i)?.[1] || "";
  const orderCode = typeof body.orderCode === "string" && /^\d{1,64}$/.test(body.orderCode)
    ? body.orderCode
    : rawOrderCode;
  if (!response.ok || !/^[0-9]{1,64}$/.test(orderCode)) {
    throw new VivaUnavailableError("VIVA_CREATE_FAILED", "Viva payment order could not be created.", response.status === 429 || response.status >= 500);
  }
  return { orderCode, checkoutUrl: vivaCheckoutUrl(config, orderCode) };
}

export type VivaTransaction = {
  transactionId: string;
  orderCode: string;
  amountCents: number;
  currency: "EUR";
  statusId: string;
  sourceCode: string;
};

export async function retrieveVivaTransaction(
  transactionId: string,
  options: { config?: VivaConfig; fetcher?: typeof fetch } = {},
): Promise<VivaTransaction> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
    throw new VivaUnavailableError("VIVA_TRANSACTION_INVALID", "Viva transaction ID is invalid.");
  }
  const config = options.config || getVivaConfig();
  const fetcher = options.fetcher || fetch;
  const token = await getAccessToken(config, fetcher);
  const response = await fetchWithTimeout(fetcher, `${config.apiBaseUrl}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const { body, raw } = await responseJson(response);
  if (!response.ok) throw new VivaUnavailableError("VIVA_TRANSACTION_UNAVAILABLE", "Viva transaction could not be verified.", response.status === 429 || response.status >= 500);
  const orderCode = raw.match(/"orderCode"\s*:\s*"?(\d{1,64})"?/i)?.[1] || "";
  const amount = Number(body.amount);
  const currencyCode = String(body.currencyCode || "");
  const statusId = String(body.statusId || "");
  const sourceCode = String(body.sourceCode || "");
  if (!orderCode || !Number.isFinite(amount) || amount < 0 || currencyCode !== "978" || !statusId) {
    throw new VivaUnavailableError("VIVA_RESPONSE_INVALID", "Viva transaction response is invalid.");
  }
  return {
    transactionId,
    orderCode,
    amountCents: Math.round(amount * 100),
    currency: "EUR",
    statusId,
    sourceCode,
  };
}

export function safeVivaError(error: unknown) {
  return error instanceof VivaUnavailableError
    ? { code: error.code, retryable: error.retryable }
    : { code: "VIVA_UNAVAILABLE", retryable: true };
}
