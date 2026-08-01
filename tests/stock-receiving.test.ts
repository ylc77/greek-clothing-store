import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { getStockOperationBarcodePlan } from "../lib/stock-receiving.ts";

test("receiving keeps an existing internal barcode", () => {
  assert.deepEqual(getStockOperationBarcodePlan({
    mode: "receiving",
    barcode: "  DRESS-BLK-M  ",
    barcodeFeatureEnabled: true,
  }), { action: "keep", barcode: "DRESS-BLK-M" });
});

test("receiving generates only when the selected Variant has no barcode", () => {
  assert.deepEqual(getStockOperationBarcodePlan({
    mode: "receiving",
    barcode: "   ",
    barcodeFeatureEnabled: true,
  }), { action: "generate", barcode: null });
});

test("stocktake and return never change barcode data", () => {
  assert.deepEqual(getStockOperationBarcodePlan({
    mode: "stocktake",
    barcode: null,
    barcodeFeatureEnabled: true,
  }), { action: "keep", barcode: null });
  assert.deepEqual(getStockOperationBarcodePlan({
    mode: "return",
    barcode: null,
    barcodeFeatureEnabled: true,
  }), { action: "keep", barcode: null });
});

test("receiving fails closed when barcode generation is not enabled", () => {
  assert.deepEqual(getStockOperationBarcodePlan({
    mode: "receiving",
    barcode: null,
    barcodeFeatureEnabled: false,
  }), { action: "unavailable", barcode: null });
});
