export type FulfillmentProfile = "boxnow_and_pickup" | "pickup_only";
export type CheckoutFulfillmentMethod = "box_now" | "store_pickup";

export type FulfillmentCartItem = {
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  fulfillmentProfile: FulfillmentProfile;
  packageWeightGrams?: number | null;
  packageLengthMm?: number | null;
  packageWidthMm?: number | null;
  packageHeightMm?: number | null;
};

export type FulfillmentSettings = {
  boxNowEnabled: boolean;
  storePickupEnabled: boolean;
  boxNowMinimumSubtotalCents: number;
  boxNowShippingFeeCents: number;
  boxNowFreeShippingThresholdCents: number | null;
  boxNowMaxWeightGrams?: number;
  boxNowMaxLengthMm?: number;
  boxNowMaxWidthMm?: number;
  boxNowMaxHeightMm?: number;
};

export type FulfillmentOption = {
  available: boolean;
  feeCents: number;
  reason: "disabled" | "pickup_only_item" | "package_limit" | "minimum_not_met" | null;
  amountMissingCents: number;
};

export type FulfillmentQuote = {
  merchandiseSubtotalCents: number;
  containsPickupOnly: boolean;
  boxNow: FulfillmentOption;
  storePickup: FulfillmentOption;
};

export type FulfillmentQuoteRequestItem = {
  productSku: string;
  size: string;
  color: string;
  quantity: number;
};

export class FulfillmentInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function fulfillmentItemKey(item: Pick<FulfillmentQuoteRequestItem, "productSku" | "size" | "color">) {
  return [item.productSku, item.size || "ONE SIZE", item.color || ""]
    .map(value => value.trim().toLocaleLowerCase())
    .join("\u001f");
}

export function parseFulfillmentQuoteRequest(raw: string): FulfillmentQuoteRequestItem[] {
  if (Buffer.byteLength(raw, "utf8") > 20_000) {
    throw new FulfillmentInputError("PAYLOAD_TOO_LARGE", "Quote request is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FulfillmentInputError("INVALID_JSON", "Quote request is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FulfillmentInputError("INVALID_REQUEST", "Quote request is invalid.");
  }
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 25) {
    throw new FulfillmentInputError("INVALID_ITEMS", "Quote request must contain between 1 and 25 items.");
  }
  const grouped = new Map<string, FulfillmentQuoteRequestItem>();
  for (const item of source.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new FulfillmentInputError("INVALID_ITEMS", "Quote item is invalid.");
    }
    const row = item as Record<string, unknown>;
    const normalized = {
      productSku: cleanText(row.productSku, 200),
      size: cleanText(row.size, 80).toUpperCase() || "ONE SIZE",
      color: cleanText(row.color, 120),
      quantity: Math.trunc(Number(row.quantity)),
    };
    if (!normalized.productSku || !Number.isInteger(normalized.quantity) || normalized.quantity < 1 || normalized.quantity > 20) {
      throw new FulfillmentInputError("INVALID_ITEMS", "Quote item is invalid.");
    }
    const key = fulfillmentItemKey(normalized);
    const previous = grouped.get(key);
    const quantity = normalized.quantity + (previous?.quantity || 0);
    if (quantity > 20) throw new FulfillmentInputError("INVALID_ITEMS", "Quote item quantity is too large.");
    grouped.set(key, { ...(previous || normalized), quantity });
  }
  return Array.from(grouped.values());
}

function assertSafeCents(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer number of cents.`);
  }
}

function optionalPositiveInteger(value: number | null | undefined, name: string) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function calculateFulfillmentOptions(
  items: FulfillmentCartItem[],
  settings: FulfillmentSettings,
): FulfillmentQuote {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Cart must contain at least one item.");
  assertSafeCents(settings.boxNowMinimumSubtotalCents, "boxNowMinimumSubtotalCents");
  assertSafeCents(settings.boxNowShippingFeeCents, "boxNowShippingFeeCents");
  if (settings.boxNowFreeShippingThresholdCents !== null) {
    assertSafeCents(settings.boxNowFreeShippingThresholdCents, "boxNowFreeShippingThresholdCents");
  }
  const maximumWeight = optionalPositiveInteger(settings.boxNowMaxWeightGrams, "boxNowMaxWeightGrams");
  const maximumLength = optionalPositiveInteger(settings.boxNowMaxLengthMm, "boxNowMaxLengthMm");
  const maximumWidth = optionalPositiveInteger(settings.boxNowMaxWidthMm, "boxNowMaxWidthMm");
  const maximumHeight = optionalPositiveInteger(settings.boxNowMaxHeightMm, "boxNowMaxHeightMm");

  let merchandiseSubtotalCents = 0;
  let containsPickupOnly = false;
  let knownPackageWeightGrams = 0;
  let exceedsPackageLimit = false;
  for (const item of items) {
    if (!item.productSku || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Cart item identity and quantity are required.");
    }
    assertSafeCents(item.unitPriceCents, "unitPriceCents");
    const lineTotal = item.unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(lineTotal)) throw new Error("Cart total exceeds the safe integer range.");
    merchandiseSubtotalCents += lineTotal;
    if (!Number.isSafeInteger(merchandiseSubtotalCents)) throw new Error("Cart total exceeds the safe integer range.");
    containsPickupOnly ||= item.fulfillmentProfile === "pickup_only";
    const weight = optionalPositiveInteger(item.packageWeightGrams, "packageWeightGrams");
    const length = optionalPositiveInteger(item.packageLengthMm, "packageLengthMm");
    const width = optionalPositiveInteger(item.packageWidthMm, "packageWidthMm");
    const height = optionalPositiveInteger(item.packageHeightMm, "packageHeightMm");
    if (weight !== null) {
      const lineWeight = weight * item.quantity;
      if (!Number.isSafeInteger(lineWeight) || !Number.isSafeInteger(knownPackageWeightGrams + lineWeight)) {
        throw new Error("Package weight exceeds the safe integer range.");
      }
      knownPackageWeightGrams += lineWeight;
    }
    exceedsPackageLimit ||= (maximumLength !== null && length !== null && length > maximumLength)
      || (maximumWidth !== null && width !== null && width > maximumWidth)
      || (maximumHeight !== null && height !== null && height > maximumHeight);
  }
  exceedsPackageLimit ||= maximumWeight !== null && knownPackageWeightGrams > maximumWeight;

  const amountMissingCents = Math.max(0, settings.boxNowMinimumSubtotalCents - merchandiseSubtotalCents);
  const boxNowReason: FulfillmentOption["reason"] = !settings.boxNowEnabled
    ? "disabled"
    : containsPickupOnly
      ? "pickup_only_item"
      : exceedsPackageLimit
        ? "package_limit"
        : amountMissingCents > 0
          ? "minimum_not_met"
          : null;
  const boxNowAvailable = boxNowReason === null;
  const boxNowFree = settings.boxNowFreeShippingThresholdCents !== null
    && merchandiseSubtotalCents >= settings.boxNowFreeShippingThresholdCents;

  return {
    merchandiseSubtotalCents,
    containsPickupOnly,
    boxNow: {
      available: boxNowAvailable,
      feeCents: boxNowAvailable && !boxNowFree ? settings.boxNowShippingFeeCents : 0,
      reason: boxNowReason,
      amountMissingCents,
    },
    storePickup: {
      available: settings.storePickupEnabled,
      feeCents: 0,
      reason: settings.storePickupEnabled ? null : "disabled",
      amountMissingCents: 0,
    },
  };
}

export function eurosToCents(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error("EUR amount must be non-negative.");
  const cents = Math.round(value * 100);
  assertSafeCents(cents, "EUR amount");
  return cents;
}

export function centsToEuros(value: number) {
  assertSafeCents(value, "cents");
  return value / 100;
}
