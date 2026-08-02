import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { barcodeForIncomingVariant, getStockOperationBarcodePlan, normalizeIncomingBarcode, resolveIncomingBarcodeTarget } from "../lib/stock-receiving.ts";

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

test("an unknown supplier barcode is trimmed and rejected when empty, unsafe, or oversized", () => {
  assert.equal(normalizeIncomingBarcode("  5201234567890  "), "5201234567890");
  assert.equal(normalizeIncomingBarcode(""), null);
  assert.equal(normalizeIncomingBarcode("ABC\n123"), null);
  assert.equal(normalizeIncomingBarcode("X".repeat(251)), null);
});

test("incoming barcode target is automatic only for one eligible Variant", () => {
  const oneVariant = [{ size: "ONE SIZE", color: "", quantity: 3 }];
  assert.equal(resolveIncomingBarcodeTarget(oneVariant, ""), "ONE SIZE\0");

  const multipleVariants = [
    { size: "M", color: "Black", quantity: 2 },
    { size: "L", color: "Black", quantity: 1 },
  ];
  assert.equal(resolveIncomingBarcodeTarget(multipleVariants, ""), null);
  assert.equal(resolveIncomingBarcodeTarget(multipleVariants, "L\0black"), "L\0black");
});

test("supplier barcode replaces only the selected Variant barcode", () => {
  assert.equal(barcodeForIncomingVariant({
    incomingBarcode: "SUPPLIER-RED-L",
    incomingTargetKey: "L\0red",
    size: "L",
    color: "Red",
    fallbackBarcode: "DRESS-RED-L",
  }), "SUPPLIER-RED-L");
  assert.equal(barcodeForIncomingVariant({
    incomingBarcode: "SUPPLIER-RED-L",
    incomingTargetKey: "L\0red",
    size: "M",
    color: "Red",
    fallbackBarcode: "DRESS-RED-M",
  }), "DRESS-RED-M");
});

test("unknown receiving barcode is connected to both product creation flows with two-image gates", () => {
  const dashboard = fs.readFileSync(path.join(process.cwd(), "components", "admin-dashboard.tsx"), "utf8");
  assert.match(dashboard, /data-unknown-receiving-barcode/);
  assert.match(dashboard, /startReceivingProductCreation\("quickAdd"\)/);
  assert.match(dashboard, /startReceivingProductCreation\("add"\)/);
  assert.match(dashboard, /receivingProductFlow === "quickAdd" && quickBackFiles\.length === 0/);
  assert.match(dashboard, /receivingProductFlow === "add" && !editingId/);
  assert.match(dashboard, /barcodeForIncomingVariant\(\{/);
  assert.match(dashboard, /barcode: incomingBarcode \|\| ""/);
});
