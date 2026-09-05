export const MAX_RECEIPT_ITEMS = 100;
export const MAX_RECEIPT_UNITS = 1_000_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InventoryReceiptInputItem = {
  variantId: string;
  quantity: number;
  unitCost: number | null;
};

export type InventoryReceiptInput = {
  clientRequestId: string;
  supplierId: string | null;
  supplierReference: string;
  notes: string;
  items: InventoryReceiptInputItem[];
};

export class InventoryReceiptValidationError extends Error {}

function text(value: unknown, max: number, field: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new InventoryReceiptValidationError(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new InventoryReceiptValidationError(`${field} is too long.`);
  return normalized;
}

export function parseInventoryReceiptInput(value: unknown): InventoryReceiptInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InventoryReceiptValidationError("Request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const clientRequestId = text(body.clientRequestId, 128, "clientRequestId");
  if (!clientRequestId) throw new InventoryReceiptValidationError("clientRequestId is required.");

  const supplierValue = body.supplierId;
  const supplierId = supplierValue === undefined || supplierValue === null || supplierValue === ""
    ? null
    : text(supplierValue, 36, "supplierId");
  if (supplierId && !UUID_PATTERN.test(supplierId)) {
    throw new InventoryReceiptValidationError("supplierId must be a UUID.");
  }

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_RECEIPT_ITEMS) {
    throw new InventoryReceiptValidationError(`items must contain 1 to ${MAX_RECEIPT_ITEMS} rows.`);
  }

  const merged = new Map<string, InventoryReceiptInputItem>();
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InventoryReceiptValidationError("Each receipt item must be an object.");
    }
    const item = raw as Record<string, unknown>;
    const variantId = text(item.variantId, 36, "variantId");
    if (!UUID_PATTERN.test(variantId)) throw new InventoryReceiptValidationError("variantId must be a UUID.");
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_RECEIPT_UNITS) {
      throw new InventoryReceiptValidationError("quantity must be a positive integer.");
    }
    const unitCost = item.unitCost === undefined || item.unitCost === null || item.unitCost === ""
      ? null
      : Number(item.unitCost);
    if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10_000_000)) {
      throw new InventoryReceiptValidationError("unitCost must be a non-negative amount.");
    }
    const previous = merged.get(variantId);
    if (previous && previous.unitCost !== unitCost) {
      throw new InventoryReceiptValidationError("Duplicate Variant rows must use the same unit cost.");
    }
    const nextQuantity = (previous?.quantity || 0) + quantity;
    if (nextQuantity > MAX_RECEIPT_UNITS) throw new InventoryReceiptValidationError("Combined quantity is too large.");
    merged.set(variantId, { variantId, quantity: nextQuantity, unitCost });
  }

  const items = [...merged.values()].sort((left, right) => left.variantId.localeCompare(right.variantId));
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalUnits > MAX_RECEIPT_UNITS) throw new InventoryReceiptValidationError("Receipt total quantity is too large.");

  return {
    clientRequestId,
    supplierId,
    supplierReference: text(body.supplierReference, 160, "supplierReference"),
    notes: text(body.notes, 500, "notes"),
    items,
  };
}

export function receiptRequestFingerprint(input: InventoryReceiptInput) {
  return JSON.stringify({
    supplierId: input.supplierId,
    supplierReference: input.supplierReference,
    notes: input.notes,
    items: input.items,
  });
}
