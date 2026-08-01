import assert from "node:assert/strict";
import test from "node:test";

// @ts-ignore Node's strip-only test runner requires the explicit .ts extension.
import { addVisibleVariantsToSelection, clearBarcodeLabelQueue, getBarcodeLabelSelectionSummary, selectVisibleMissingBarcodes } from "../lib/barcode-label-selection.ts";

const variants = [
  { variant_id: "v-1", product_id: 1, barcode: null, quantity_on_hand: 2 },
  { variant_id: "v-2", product_id: 1, barcode: "SKU-1-M", quantity_on_hand: 4 },
  { variant_id: "v-3", product_id: 2, barcode: "", quantity_on_hand: 0 },
];

test("select all current results preserves variants selected by another filter", () => {
  const selected = addVisibleVariantsToSelection(new Set(["outside-filter"]), variants.slice(0, 2));
  assert.deepEqual([...selected].sort(), ["outside-filter", "v-1", "v-2"]);
});

test("select missing barcodes only adds visible variants with an empty barcode", () => {
  const selected = selectVisibleMissingBarcodes(new Set(["outside-filter"]), variants);
  assert.deepEqual([...selected].sort(), ["outside-filter", "v-1", "v-3"]);
});

test("summary deduplicates products and separates missing from existing barcodes", () => {
  const summary = getBarcodeLabelSelectionSummary({
    visibleItems: variants,
    allItems: variants,
    selectedVariantIds: new Set(["v-1", "v-2", "v-3"]),
    copyCounts: { "v-1": 3, "v-2": 1 },
  });

  assert.deepEqual(summary, {
    allMissingBarcodeProductCount: 2,
    allMissingBarcodeCount: 2,
    visibleProductCount: 2,
    visibleVariantCount: 3,
    visibleMissingBarcodeCount: 2,
    visibleExistingBarcodeCount: 1,
    selectedProductCount: 2,
    selectedVariantCount: 3,
    selectedMissingBarcodeCount: 2,
    selectedExistingBarcodeCount: 1,
    estimatedPrintCopies: 5,
  });
});

test("cancel selection clears the selection, print quantities and preview queue", () => {
  const cleared = clearBarcodeLabelQueue();
  assert.equal(cleared.selectedVariantIds.size, 0);
  assert.deepEqual(cleared.copyCounts, {});
  assert.equal(cleared.previewItems, null);
});
