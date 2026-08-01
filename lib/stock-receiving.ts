export type StockOperationBarcodePlan =
  | { action: "keep"; barcode: string | null }
  | { action: "generate"; barcode: null }
  | { action: "unavailable"; barcode: null };

function clean(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
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
