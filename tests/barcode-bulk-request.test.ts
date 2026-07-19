import assert from "node:assert/strict";
import test from "node:test";

// @ts-ignore Node's strip-only test runner requires the explicit .ts extension.
import { BarcodeBulkRequestError, parseBulkBarcodeRequest } from "../lib/barcode-bulk-request.ts";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

test("bulk request validation deduplicates and sorts Variant IDs", () => {
  assert.deepEqual(parseBulkBarcodeRequest({
    variantIds: [id(2), id(1), id(2)],
    clientRequestId: " operation-1 ",
    mode: "variant_sku",
  }), {
    variantIds: [id(1), id(2)],
    clientRequestId: "operation-1",
    mode: "variant_sku",
  });
  assert.deepEqual(parseBulkBarcodeRequest({
    variantIds: Array.from({ length: 101 }, () => id(1)),
    clientRequestId: "operation-duplicates",
  }).variantIds, [id(1)]);
});

test("bulk request validation rejects custom barcode fields and unknown keys", () => {
  assert.throws(
    () => parseBulkBarcodeRequest({ variantIds: [id(1)], clientRequestId: "operation-1", barcode: "CUSTOM" }),
    (error: unknown) => error instanceof BarcodeBulkRequestError && error.code === "BARCODE_INVALID_ARGUMENT",
  );
});

test("bulk request validation rejects empty, malformed and oversized requests", () => {
  assert.throws(() => parseBulkBarcodeRequest({ variantIds: [], clientRequestId: "operation-1" }), BarcodeBulkRequestError);
  assert.throws(() => parseBulkBarcodeRequest({ variantIds: ["not-a-uuid"], clientRequestId: "operation-1" }), BarcodeBulkRequestError);
  assert.throws(() => parseBulkBarcodeRequest({ variantIds: [id(1)], clientRequestId: "" }), BarcodeBulkRequestError);
  assert.throws(
    () => parseBulkBarcodeRequest({ variantIds: Array.from({ length: 101 }, (_, index) => id(index + 1)), clientRequestId: "operation-1" }),
    (error: unknown) => error instanceof BarcodeBulkRequestError && error.code === "BARCODE_BATCH_TOO_LARGE",
  );
});
