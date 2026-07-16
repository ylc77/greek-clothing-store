import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { reconcileStorageInventory } from "../lib/storage-reconciliation.ts";

test("read-only reconciliation reports orphan objects, missing references, and pending cleanup", () => {
  const report = reconcileStorageInventory({
    objectPaths: ["products/1/a.webp", "products/2/orphan.webp", "store/logo/current.webp"],
    referencedPaths: ["products/1/a.webp", "products/3/missing.webp", "store/logo/current.webp"],
    pendingCleanupPaths: ["products/2/orphan.webp"],
  });
  assert.deepEqual(report.orphanPaths, ["products/2/orphan.webp"]);
  assert.deepEqual(report.missingObjectPaths, ["products/3/missing.webp"]);
  assert.deepEqual(report.pendingCleanupPaths, ["products/2/orphan.webp"]);
  assert.equal(report.mutated, false);
});
