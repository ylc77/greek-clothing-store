export type BoxNowConfig = {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  originId: string;
  partnerId: string;
};

export type BoxNowShipmentInput = {
  orderNumber: string;
  totalCents: number;
  customer: { name: string; email: string; phone: string };
  lockerId: string;
  origin: { name: string; email: string; phone: string };
  items: Array<{ id: string; name: string; valueCents: number; weightGrams?: number }>;
};

export type BoxNowShipment = { referenceNumber: string; parcelId: string };
export type BoxNowParcelState = "new" | "wait-for-load" | "in-transit" | "in-depot" | "in-final-destination" | "delivered" | "expired-return" | "accepted-for-return" | "returned" | "cancelled" | "lost" | "missing";

export class BoxNowUnavailableError extends Error {
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
  if (!value) throw new BoxNowUnavailableError("BOXNOW_NOT_CONFIGURED", "BOX NOW is not configured.");
  return value;
}

function httpsBase(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new BoxNowUnavailableError("BOXNOW_NOT_CONFIGURED", "BOX NOW API URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new BoxNowUnavailableError("BOXNOW_NOT_CONFIGURED", "BOX NOW API URL is invalid.");
  }
  return url.toString().replace(/\/$/, "");
}

export function getBoxNowConfig(): BoxNowConfig {
  return {
    apiBaseUrl: httpsBase(required("BOXNOW_API_BASE_URL")),
    clientId: required("BOXNOW_CLIENT_ID"),
    clientSecret: required("BOXNOW_CLIENT_SECRET"),
    originId: required("BOXNOW_ORIGIN_ID"),
    partnerId: required("BOXNOW_PARTNER_ID"),
  };
}

async function request(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, cache: "no-store", signal: controller.signal });
  } catch {
    throw new BoxNowUnavailableError("BOXNOW_REQUEST_UNKNOWN", "BOX NOW request outcome is unknown.", true);
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response) {
  const raw = await response.text();
  if (raw.length > 64_000) throw new BoxNowUnavailableError("BOXNOW_RESPONSE_INVALID", "BOX NOW returned an oversized response.", true);
  try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  catch { throw new BoxNowUnavailableError("BOXNOW_RESPONSE_INVALID", "BOX NOW returned an invalid response.", true); }
}

async function accessToken(config: BoxNowConfig, fetcher: typeof fetch) {
  const response = await request(fetcher, `${config.apiBaseUrl}/api/v1/auth-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }),
  });
  const body = await readJson(response);
  const token = typeof body.access_token === "string" ? body.access_token : "";
  if (!response.ok || !token) throw new BoxNowUnavailableError("BOXNOW_AUTH_FAILED", "BOX NOW authentication failed.", response.status === 429 || response.status >= 500);
  return token;
}

export async function verifyBoxNowConnection(
  options: { config?: BoxNowConfig; fetcher?: typeof fetch } = {},
) {
  const config = options.config || getBoxNowConfig();
  await accessToken(config, options.fetcher || fetch);
  return { ok: true as const };
}

function euros(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new BoxNowUnavailableError("BOXNOW_AMOUNT_INVALID", "BOX NOW amount is invalid.");
  return (cents / 100).toFixed(2);
}

function bounded(value: string, max: number, field: string) {
  const normalized = value.trim().slice(0, max);
  if (!normalized) throw new BoxNowUnavailableError("BOXNOW_INPUT_INVALID", `BOX NOW ${field} is required.`);
  return normalized;
}

export async function createBoxNowShipment(input: BoxNowShipmentInput, options: { config?: BoxNowConfig; fetcher?: typeof fetch } = {}): Promise<BoxNowShipment> {
  if (!Array.isArray(input.items) || input.items.length !== 1) {
    throw new BoxNowUnavailableError("BOXNOW_PACKAGE_INVALID", "The first release supports exactly one parcel per order.");
  }
  const config = options.config || getBoxNowConfig();
  const fetcher = options.fetcher || fetch;
  const token = await accessToken(config, fetcher);
  const response = await request(fetcher, `${config.apiBaseUrl}/api/v1/delivery-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-PartnerID": config.partnerId },
    body: JSON.stringify({
      orderNumber: bounded(input.orderNumber, 100, "order number"),
      invoiceValue: euros(input.totalCents),
      paymentMode: "prepaid",
      amountToBeCollected: "0.00",
      allowReturn: true,
      origin: {
        contactNumber: bounded(input.origin.phone, 40, "origin phone"),
        contactEmail: bounded(input.origin.email, 200, "origin email"),
        contactName: bounded(input.origin.name, 200, "origin name"),
        locationId: config.originId,
      },
      destination: {
        contactNumber: bounded(input.customer.phone, 40, "customer phone"),
        contactEmail: bounded(input.customer.email, 200, "customer email"),
        contactName: bounded(input.customer.name, 200, "customer name"),
        locationId: bounded(input.lockerId, 120, "Locker ID"),
      },
      items: input.items.map(item => ({
        id: bounded(item.id, 100, "parcel ID"),
        name: bounded(item.name, 200, "parcel name"),
        value: euros(item.valueCents),
        weight: Math.max(0, Math.trunc(Number(item.weightGrams) || 0)),
      })),
    }),
  });
  const body = await readJson(response);
  const parcels = Array.isArray(body.parcels) ? body.parcels : [];
  const parcel = parcels[0] && typeof parcels[0] === "object" ? parcels[0] as Record<string, unknown> : {};
  const referenceNumber = String(body.referenceNumber || "").trim();
  const parcelId = String(parcel.id || "").trim();
  if (!response.ok || !referenceNumber || !parcelId) {
    const conflict = response.status === 409 || String(body.code || "").toUpperCase() === "P410";
    throw new BoxNowUnavailableError(conflict ? "BOXNOW_ORDER_CONFLICT" : "BOXNOW_CREATE_FAILED", "BOX NOW shipment could not be created.", response.status === 429 || response.status >= 500);
  }
  return { referenceNumber, parcelId };
}

export async function fetchBoxNowLabel(parcelId: string, options: { config?: BoxNowConfig; fetcher?: typeof fetch } = {}) {
  const config = options.config || getBoxNowConfig();
  const fetcher = options.fetcher || fetch;
  const token = await accessToken(config, fetcher);
  const safeId = bounded(parcelId, 120, "parcel ID");
  const response = await request(fetcher, `${config.apiBaseUrl}/api/v1/parcels/${encodeURIComponent(safeId)}/label.pdf`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf", "X-PartnerID": config.partnerId },
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok || !contentType.includes("application/pdf")) throw new BoxNowUnavailableError("BOXNOW_LABEL_FAILED", "BOX NOW label could not be retrieved.", response.status === 429 || response.status >= 500);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 4 || bytes.byteLength > 10 * 1024 * 1024 || Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new BoxNowUnavailableError("BOXNOW_LABEL_INVALID", "BOX NOW returned an invalid label.");
  }
  return bytes;
}

export async function cancelBoxNowParcel(parcelId: string, options: { config?: BoxNowConfig; fetcher?: typeof fetch } = {}) {
  const config = options.config || getBoxNowConfig();
  const fetcher = options.fetcher || fetch;
  const token = await accessToken(config, fetcher);
  const safeId = bounded(parcelId, 120, "parcel ID");
  const response = await request(fetcher, `${config.apiBaseUrl}/api/v1/parcels/${encodeURIComponent(safeId)}:cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-PartnerID": config.partnerId },
  });
  if (response.ok) return;
  const retryable = response.status === 429 || response.status >= 500;
  throw new BoxNowUnavailableError(
    retryable ? "BOXNOW_CANCEL_UNKNOWN" : "BOXNOW_CANCEL_REJECTED",
    retryable ? "BOX NOW cancellation outcome is unknown." : "BOX NOW rejected the cancellation.",
    retryable,
  );
}

export async function fetchBoxNowParcelState(parcelId: string, options: { config?: BoxNowConfig; fetcher?: typeof fetch } = {}): Promise<BoxNowParcelState> {
  const config = options.config || getBoxNowConfig();
  const fetcher = options.fetcher || fetch;
  const token = await accessToken(config, fetcher);
  const safeId = bounded(parcelId, 120, "parcel ID");
  const url = new URL(`${config.apiBaseUrl}/api/v1/parcels`);
  url.searchParams.set("parcelId", safeId);
  url.searchParams.set("limit", "1");
  const response = await request(fetcher, url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-PartnerID": config.partnerId },
  });
  const body = await readJson(response);
  if (!response.ok) throw new BoxNowUnavailableError("BOXNOW_REFRESH_FAILED", "BOX NOW parcel status could not be retrieved.", response.status === 429 || response.status >= 500);
  const rows = Array.isArray(body.data) ? body.data : [];
  const row = rows.find(item => item && typeof item === "object" && String((item as Record<string, unknown>).id || "") === safeId) as Record<string, unknown> | undefined;
  const rawState = String(row?.state || "").trim().toLowerCase();
  const state = rawState === "intransit" ? "in-transit" : rawState;
  const supported = new Set<BoxNowParcelState>(["new", "wait-for-load", "in-transit", "in-depot", "in-final-destination", "delivered", "expired-return", "accepted-for-return", "returned", "cancelled", "lost", "missing"]);
  if (!supported.has(state as BoxNowParcelState)) throw new BoxNowUnavailableError("BOXNOW_STATUS_UNKNOWN", "BOX NOW returned an unknown parcel status.", true);
  return state as BoxNowParcelState;
}

export function safeBoxNowError(error: unknown) {
  return error instanceof BoxNowUnavailableError ? { code: error.code, retryable: error.retryable } : { code: "BOXNOW_UNAVAILABLE", retryable: true };
}
