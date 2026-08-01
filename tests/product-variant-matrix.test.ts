import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { buildVariantSku, matrixColors, matrixSizeStock, matrixTotal, publicVariantOptions, sizeOptionsForColor, variantCatalogKey } from "../lib/product-variant-matrix.ts";

test("aggregates the legacy size projection across colors", () => {
  const rows = [
    { size: "L", color: "Yellow", quantity: 2 },
    { size: "L", color: "Green", quantity: 0 },
    { size: "XL", color: "Yellow", quantity: 3 },
    { size: "XL", color: "Green", quantity: 4 },
  ];
  assert.deepEqual(matrixSizeStock(rows), { L: 2, XL: 7 });
  assert.equal(matrixTotal(rows), 9);
  assert.deepEqual(matrixColors(rows), ["Yellow", "Green"]);
});

test("uses size and color as the Variant catalog identity", () => {
  assert.notEqual(variantCatalogKey("L", "Yellow"), variantCatalogKey("L", "Green"));
  assert.equal(variantCatalogKey("l", " yellow "), variantCatalogKey("L", "Yellow"));
});

test("builds deterministic readable Variant SKUs and keeps colors independent", () => {
  assert.equal(buildVariantSku("dress-001", "L", "Yellow"), "dress-001-YELLOW-L");
  assert.equal(buildVariantSku("dress-001", "ONE SIZE", "Yellow"), "dress-001-YELLOW");
  assert.notEqual(buildVariantSku("dress-001", "L", "黄色"), buildVariantSku("dress-001", "L", "绿色"));
});

test("public options disable sold-out sizes only for the selected color", () => {
  const variants = publicVariantOptions([
    { size: "L", color: "Yellow", quantity_available: 2 },
    { size: "L", color: "Green", quantity_available: 0 },
    { size: "XL", color: "Green", quantity_available: 3 },
  ]);
  assert.deepEqual(sizeOptionsForColor(variants, "Green"), [
    { label: "L", quantity: 0, disabled: true },
    { label: "XL", quantity: 3, disabled: false },
  ]);
  assert.deepEqual(sizeOptionsForColor(variants, "Yellow"), [
    { label: "L", quantity: 2, disabled: false },
  ]);
});
