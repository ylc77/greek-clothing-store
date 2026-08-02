export type CartAvailabilityRequestItem = {
  productSku: string;
  size: string;
  color: string;
};

export type CartAvailabilityItem = CartAvailabilityRequestItem & {
  availableQuantity: number;
  unitPrice: number | null;
};

export class CartAvailabilityInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function cartAvailabilityKey(item: Pick<CartAvailabilityRequestItem, "productSku" | "size" | "color">) {
  return [item.productSku, item.size || "ONE SIZE", item.color || ""]
    .map(value => value.trim().toLocaleLowerCase())
    .join("\u001f");
}

export function parseCartAvailabilityRequest(raw: string): CartAvailabilityRequestItem[] {
  if (Buffer.byteLength(raw, "utf8") > 16_000) {
    throw new CartAvailabilityInputError("PAYLOAD_TOO_LARGE", "Availability request is too large.");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CartAvailabilityInputError("INVALID_JSON", "Availability request is invalid.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CartAvailabilityInputError("INVALID_REQUEST", "Availability request is invalid.");
  }

  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 25) {
    throw new CartAvailabilityInputError("INVALID_ITEMS", "Availability request must contain between 1 and 25 items.");
  }

  const unique = new Map<string, CartAvailabilityRequestItem>();
  for (const item of source.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CartAvailabilityInputError("INVALID_ITEMS", "Availability item is invalid.");
    }
    const row = item as Record<string, unknown>;
    const normalized = {
      productSku: cleanText(row.productSku, 200),
      size: cleanText(row.size, 80).toUpperCase() || "ONE SIZE",
      color: cleanText(row.color, 120),
    };
    if (!normalized.productSku) {
      throw new CartAvailabilityInputError("INVALID_ITEMS", "Product SKU is required.");
    }
    const key = cartAvailabilityKey(normalized);
    if (!unique.has(key)) unique.set(key, normalized);
  }

  return Array.from(unique.values());
}
