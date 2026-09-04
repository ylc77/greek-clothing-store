import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node tests require explicit TypeScript extension.
import { createBarcodeScanner } from "../lib/barcode-scanner.ts";
// @ts-expect-error Node tests require explicit TypeScript extension.
import { emptyLabelQueue, operationLabelQueue } from "../lib/operation-label-queue.ts";
// @ts-expect-error Node tests require explicit TypeScript extension.
import { getAdminDefaultView, adminWorkspaceActions, getAdminPrimaryNavigation, legacyAdminSection } from "../lib/admin-navigation.ts";

test("scanner buffers rapid characters until Enter and resets for the next scan", () => {
  const scanner = createBarcodeScanner();
  for (const [index, key] of [..."ABC123"].entries()) assert.equal(scanner.push(key, index * 10), null);
  assert.equal(scanner.push("Enter", 60), "ABC123");
  assert.equal(scanner.push("Enter", 70), null);
  for (const [index, key] of [..."ABC123"].entries()) scanner.push(key, 100 + index * 10);
  assert.equal(scanner.push("Enter", 160), "ABC123");
});
test("slow typing, short codes, overflow and interrupted input do not trigger scanner", () => {
  const scanner = createBarcodeScanner({ minLength: 3, maxLength: 6 });
  for (const [index, key] of [..."ABC123"].entries()) scanner.push(key, index * 150);
  assert.equal(scanner.push("Enter", 760), null);
  scanner.push("A", 800); scanner.push("B", 810);
  assert.equal(scanner.push("Enter", 820), null);
  for (const [index, key] of [..."ABCDEFG"].entries()) scanner.push(key, 900 + index * 10);
  assert.equal(scanner.push("Enter", 970), null);
  scanner.push("A", 1000); scanner.reset(); assert.equal(scanner.push("Enter", 1010), null);
});
const label = (id: string, onHand = 100) => ({ variant_id: id, barcode: `BC-${id}`, product_name: "Test", product_sku: "TEST", variant_sku: `TEST-${id}`, size: id, color: null, price: 10, quantity_on_hand: onHand, active: true });
test("first receiving S=2, M=3 queues five labels, not total stock", () => {
  const result = operationLabelQueue(emptyLabelQueue(), { type: "enqueue", operationId: "create", source: "首次入库", labels: [{ label: label("S"), copies: 2 }, { label: label("M"), copies: 3 }] });
  assert.equal(result.entries.reduce((sum, entry) => sum + entry.copies, 0), 5);
});
test("receiving merges same Variant by the increment and is replay safe even after clearing", () => {
  const action = { type: "enqueue" as const, operationId: "receive1", source: "到货", labels: [{ label: label("S", 102), copies: 2 }] };
  let state = operationLabelQueue(emptyLabelQueue(), action);
  state = operationLabelQueue(state, { ...action, operationId: "receive2", labels: [{ label: label("S", 105), copies: 3 }] });
  assert.equal(state.entries.length, 1); assert.equal(state.entries[0].copies, 5);
  assert.equal(operationLabelQueue(state, action), state);
  state = operationLabelQueue(state, { type: "clear" });
  assert.equal(operationLabelQueue(state, action).entries.length, 0);
});
test("queue supports edits and removal but refuses absent authoritative barcodes and invalid quantities", () => {
  const action = { type: "enqueue" as const, operationId: "receive", source: "到货", labels: [{ label: label("S"), copies: 2 }] };
  let state = operationLabelQueue(emptyLabelQueue(), action);
  state = operationLabelQueue(state, { type: "copies", variantId: "S", copies: 7 });
  assert.equal(state.entries[0].copies, 7);
  assert.equal(operationLabelQueue(state, { type: "copies", variantId: "S", copies: -1 }), state);
  assert.equal(operationLabelQueue(state, { type: "remove", variantId: "S" }).entries.length, 0);
  assert.equal(operationLabelQueue(emptyLabelQueue(), { ...action, labels: [{ label: { ...label("S"), barcode: null }, copies: 2 }] }).entries.length, 0);
});
test("role home pages and hidden emergency deduction remain presentation-only", () => {
  assert.equal(getAdminDefaultView("owner"), "workspace");
  assert.equal(getAdminDefaultView("staff"), "pos");
  assert.equal(getAdminDefaultView("inventory"), "stockOperations");
  assert.equal(getAdminDefaultView("readonly"), "workspace");
  for (const actions of Object.values(adminWorkspaceActions)) assert.ok(actions.every(action => action.view !== "quickSale"));
  assert.equal(legacyAdminSection.quickSale, "more");
  assert.deepEqual(getAdminPrimaryNavigation(view => view === "workspace", false).map(item => item.key), ["workspace"]);
  assert.equal(getAdminPrimaryNavigation(() => true, false).length, 6);
});
