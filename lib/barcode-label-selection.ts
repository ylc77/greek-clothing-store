export type BarcodeLabelItem = {
  variant_id: string;
  product_id: string | number;
  barcode?: string | null;
  quantity_on_hand: number;
};

function normalizeCopies(value: unknown, stockFallback: unknown) {
  const requested = Number(value);
  const fallback = Number(stockFallback);
  const selected = Number.isFinite(requested)
    ? Math.trunc(requested)
    : Number.isFinite(fallback)
      ? Math.trunc(fallback)
      : 1;
  return Math.min(500, Math.max(1, selected));
}

export function barcodeIsPresent(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function addVisibleVariantsToSelection<T extends Pick<BarcodeLabelItem, "variant_id">>(
  current: ReadonlySet<string>,
  visibleItems: readonly T[],
) {
  const next = new Set(current);
  for (const item of visibleItems) next.add(item.variant_id);
  return next;
}

export function selectVisibleMissingBarcodes<T extends Pick<BarcodeLabelItem, "variant_id" | "barcode">>(
  current: ReadonlySet<string>,
  visibleItems: readonly T[],
) {
  return addVisibleVariantsToSelection(current, visibleItems.filter((item) => !barcodeIsPresent(item.barcode)));
}

export function clearBarcodeLabelQueue() {
  return {
    selectedVariantIds: new Set<string>(),
    copyCounts: {} as Record<string, number>,
    previewItems: null,
  };
}

export function getBarcodeLabelSelectionSummary<T extends BarcodeLabelItem>({
  visibleItems,
  allItems,
  selectedVariantIds,
  copyCounts,
}: {
  visibleItems: readonly T[];
  allItems: readonly T[];
  selectedVariantIds: ReadonlySet<string>;
  copyCounts: Readonly<Record<string, number>>;
}) {
  const selectedItems = allItems.filter((item) => selectedVariantIds.has(item.variant_id));
  const visibleMissingBarcodeCount = visibleItems.filter((item) => !barcodeIsPresent(item.barcode)).length;
  const selectedMissingBarcodeCount = selectedItems.filter((item) => !barcodeIsPresent(item.barcode)).length;

  return {
    visibleProductCount: new Set(visibleItems.map((item) => String(item.product_id))).size,
    visibleVariantCount: visibleItems.length,
    visibleMissingBarcodeCount,
    visibleExistingBarcodeCount: visibleItems.length - visibleMissingBarcodeCount,
    selectedProductCount: new Set(selectedItems.map((item) => String(item.product_id))).size,
    selectedVariantCount: selectedItems.length,
    selectedMissingBarcodeCount,
    selectedExistingBarcodeCount: selectedItems.length - selectedMissingBarcodeCount,
    estimatedPrintCopies: selectedItems.reduce(
      (sum, item) => sum + normalizeCopies(copyCounts[item.variant_id], item.quantity_on_hand),
      0,
    ),
  };
}
