export type FulfillmentMethod = "delivery" | "pickup";
export type OnlineOrderRequest = {
  operationId: string;
  accessToken: string;
  fulfillmentMethod: FulfillmentMethod;
  customer: {
    name: string;
    email: string;
    phone: string;
    addressLine1: string;
    city: string;
    postalCode: string;
    notes: string;
  };
  items: Array<{ productSku: string; size: string; color: string; quantity: number }>;
  locale: "el" | "en";
  legalAccepted: true;
};

export class OnlineOrderInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function string(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseOnlineOrderRequest(raw: string): OnlineOrderRequest {
  if (Buffer.byteLength(raw, "utf8") > 32_000) throw new OnlineOrderInputError("PAYLOAD_TOO_LARGE", "Order request is too large.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new OnlineOrderInputError("INVALID_JSON", "Order request is invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OnlineOrderInputError("INVALID_ORDER", "Order request is invalid.");
  const source = value as Record<string, unknown>;
  const operationId = string(source.operationId, 80);
  const accessToken = string(source.accessToken, 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new OnlineOrderInputError("INVALID_OPERATION_ID", "Order operation ID is invalid.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) throw new OnlineOrderInputError("INVALID_ACCESS_TOKEN", "Order access token is invalid.");
  const fulfillmentMethod = source.fulfillmentMethod === "pickup" ? "pickup" : source.fulfillmentMethod === "delivery" ? "delivery" : null;
  if (!fulfillmentMethod) throw new OnlineOrderInputError("INVALID_FULFILLMENT", "Choose delivery or store pickup.");
  const customerSource = source.customer && typeof source.customer === "object" && !Array.isArray(source.customer) ? source.customer as Record<string, unknown> : {};
  const customer = {
    name: string(customerSource.name, 120),
    email: string(customerSource.email, 200).toLowerCase(),
    phone: string(customerSource.phone, 40),
    addressLine1: string(customerSource.addressLine1, 240),
    city: string(customerSource.city, 120),
    postalCode: string(customerSource.postalCode, 20),
    notes: string(customerSource.notes, 800),
  };
  if (customer.name.length < 2 || !/^\S+@\S+\.\S+$/.test(customer.email) || customer.phone.length < 6) throw new OnlineOrderInputError("INVALID_CUSTOMER", "Name, email and phone are required.");
  if (fulfillmentMethod === "delivery" && (!customer.addressLine1 || !customer.city || !/^[0-9A-Za-z -]{3,20}$/.test(customer.postalCode))) throw new OnlineOrderInputError("DELIVERY_ADDRESS_REQUIRED", "A valid delivery address is required.");
  if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 25) throw new OnlineOrderInputError("INVALID_ITEMS", "Cart must contain between 1 and 25 items.");
  const grouped = new Map<string, OnlineOrderRequest["items"][number]>();
  for (const item of source.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new OnlineOrderInputError("INVALID_ITEMS", "Cart item is invalid.");
    const row = item as Record<string, unknown>;
    const productSku = string(row.productSku, 200);
    const size = string(row.size, 80).toUpperCase() || "ONE SIZE";
    const color = string(row.color, 120);
    const quantity = Math.trunc(Number(row.quantity));
    if (!productSku || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new OnlineOrderInputError("INVALID_ITEMS", "Cart item quantity is invalid.");
    const key = `${productSku.toLocaleLowerCase()}\u001f${size}\u001f${color.toLocaleLowerCase()}`;
    const existing = grouped.get(key);
    const total = (existing?.quantity || 0) + quantity;
    if (total > 20) throw new OnlineOrderInputError("INVALID_ITEMS", "Cart item quantity is too large.");
    grouped.set(key, { productSku, size, color, quantity: total });
  }
  const items = Array.from(grouped.values()).sort((a, b) => `${a.productSku}\0${a.size}\0${a.color}`.localeCompare(`${b.productSku}\0${b.size}\0${b.color}`));
  return {
    operationId,
    accessToken,
    fulfillmentMethod,
    customer,
    items,
    locale: source.locale === "en" ? "en" : "el",
    legalAccepted: source.legalAccepted === true ? true : (() => { throw new OnlineOrderInputError("LEGAL_ACCEPTANCE_REQUIRED", "Terms and privacy acceptance is required."); })(),
  };
}

export function onlineOrderFingerprintPayload(input: OnlineOrderRequest) {
  return JSON.stringify({
    fulfillmentMethod: input.fulfillmentMethod,
    customer: input.customer,
    items: input.items,
    locale: input.locale,
    legalAccepted: input.legalAccepted,
  });
}
