export type StockOperationBarcodePlan =
  | { action: "keep"; barcode: string | null }
  | { action: "generate"; barcode: null }
  | { action: "unavailable"; barcode: null };

function clean(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeIncomingBarcode(value: string | null | undefined) {
  const barcode = clean(value);
  if (!barcode || barcode.length > 250 || /[\u0000-\u001f\u007f]/.test(barcode)) return null;
  return barcode;
}

export function incomingVariantKey(size: unknown, color: unknown) {
  const normalizedSize = String(size || "").trim().toUpperCase() || "ONE SIZE";
  const normalizedColor = String(color || "").trim().toLocaleLowerCase();
  return `${normalizedSize}\u0000${normalizedColor}`;
}

export function resolveIncomingBarcodeTarget(
  rows: Array<{ size: unknown; color: unknown; quantity?: unknown; active?: boolean }>,
  selectedKey: string,
) {
  const eligible = rows.filter((row) => row.active !== false);
  const selected = selectedKey.trim();
  if (selected && eligible.some((row) => incomingVariantKey(row.size, row.color) === selected)) return selected;

  const withStock = eligible.filter((row) => Number(row.quantity || 0) > 0);
  const candidates = withStock.length > 0 ? withStock : eligible;
  return candidates.length === 1 ? incomingVariantKey(candidates[0].size, candidates[0].color) : null;
}

export function barcodeForIncomingVariant({
  incomingBarcode,
  incomingTargetKey,
  size,
  color,
  fallbackBarcode,
}: {
  incomingBarcode: string | null | undefined;
  incomingTargetKey: string | null | undefined;
  size: unknown;
  color: unknown;
  fallbackBarcode: string;
}) {
  const barcode = normalizeIncomingBarcode(incomingBarcode);
  if (barcode && incomingTargetKey === incomingVariantKey(size, color)) return barcode;
  return fallbackBarcode;
}

/**
 * Receiving may create a missing internal Variant barcode, but other inventory
 * operations must never change product identification data. The actual value is
 * still generated server-side from variant_sku by the existing barcode RPC.
 */
export function getStockOperationBarcodePlan({
  mode,
  barcode,
  barcodeFeatureEnabled,
}: {
  mode: "stocktake" | "receiving" | "return";
  barcode: string | null | undefined;
  barcodeFeatureEnabled: boolean;
}): StockOperationBarcodePlan {
  const existingBarcode = clean(barcode);
  if (existingBarcode) return { action: "keep", barcode: existingBarcode };
  if (mode !== "receiving") return { action: "keep", barcode: null };
  if (!barcodeFeatureEnabled) return { action: "unavailable", barcode: null };
  return { action: "generate", barcode: null };
}
