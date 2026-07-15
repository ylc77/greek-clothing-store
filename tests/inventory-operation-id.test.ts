import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { InventoryOperationIdStore, InventoryOperationStateError, type InventoryOperationStorage } from "../lib/inventory-operation-id.ts";

class MemoryStorage implements InventoryOperationStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class DisabledStorage implements InventoryOperationStorage {
  getItem() { return null; }
  setItem() { throw new Error("storage disabled"); }
  removeItem() { throw new Error("storage disabled"); }
}

function fixture(now = 1_000) {
  let next = 0;
  const storage = new MemoryStorage();
  return {
    storage,
    store: new InventoryOperationIdStore("inventory", storage, {
      createId: () => `operation-${++next}`,
      now: () => now,
      ttlMs: 100,
    }),
    next: () => next,
  };
}

test("double click and retry keep one inventory business ID", () => {
  const { store } = fixture();
  const first = store.getOrCreate("adjust:variant-1", "set_to:5");
  store.markAttempt("adjust:variant-1", first);

  assert.equal(store.getOrCreate("adjust:variant-1", "set_to:5"), first);
  assert.equal(store.getOrCreate("adjust:variant-1", "set_to:5"), first);
});

test("response loss survives page refresh through session storage", () => {
  let next = 0;
  const storage = new MemoryStorage();
  const options = { createId: () => `operation-${++next}`, now: () => 1_000, ttlMs: 10_000 };
  const beforeLoss = new InventoryOperationIdStore("quick-sell", storage, options);
  const id = beforeLoss.getOrCreate("variant-1", "quantity:1");
  beforeLoss.markAttempt("variant-1", id);
  const afterRefresh = new InventoryOperationIdStore("quick-sell", storage, options);

  assert.equal(afterRefresh.getOrCreate("variant-1", "quantity:1"), id);
  assert.equal(next, 1);
});

test("success, known no-write failure, and explicit cancel clear an operation", () => {
  const { store } = fixture();
  const first = store.getOrCreate("adjust:variant-1", "adjust_by:1");
  store.complete("adjust:variant-1", first);
  assert.equal(store.getOrCreate("adjust:variant-1", "adjust_by:1"), "operation-2");

  const second = store.getOrCreate("adjust:variant-2", "adjust_by:-1");
  store.discardKnownNoWrite("adjust:variant-2", second);
  assert.equal(store.getOrCreate("adjust:variant-2", "adjust_by:-1"), "operation-4");

  store.cancel("adjust:variant-2");
  assert.equal(store.getOrCreate("adjust:variant-2", "adjust_by:-1"), "operation-5");
});

test("different variants and inventory versus quick sell have isolated scopes", () => {
  let next = 0;
  const storage = new MemoryStorage();
  const options = { createId: () => `operation-${++next}`, now: () => 1_000, ttlMs: 10_000 };
  const inventory = new InventoryOperationIdStore("inventory", storage, options);
  const quickSell = new InventoryOperationIdStore("quick-sell", storage, options);

  const firstVariant = inventory.getOrCreate("variant-1", "set_to:2");
  const secondVariant = inventory.getOrCreate("variant-2", "set_to:2");
  const sale = quickSell.getOrCreate("variant-1", "quantity:1");

  assert.notEqual(firstVariant, secondVariant);
  assert.notEqual(firstVariant, sale);
});

test("corrupt persisted JSON blocks writes until the user explicitly cancels", () => {
  const { storage, store } = fixture();
  storage.values.set(store.storageKeyForTest("variant-1"), "{not-json");

  assert.throws(
    () => store.getOrCreate("variant-1", "quantity:1"),
    (error: unknown) => error instanceof InventoryOperationStateError && error.code === "OPERATION_STATE_CORRUPT",
  );
  store.cancel("variant-1");
  assert.equal(store.getOrCreate("variant-1", "quantity:1"), "operation-1");
});

test("disabled storage fails closed before any inventory request", () => {
  const store = new InventoryOperationIdStore("inventory", new DisabledStorage(), {
    createId: () => "operation-1",
    now: () => 1_000,
    ttlMs: 10_000,
  });

  assert.throws(
    () => store.getOrCreate("variant-1", "quantity:1"),
    (error: unknown) => error instanceof InventoryOperationStateError && error.code === "OPERATION_STORAGE_UNAVAILABLE",
  );
});

test("expired attempted operations never silently create a replacement ID", () => {
  let now = 1_000;
  let next = 0;
  const storage = new MemoryStorage();
  const store = new InventoryOperationIdStore("inventory", storage, {
    createId: () => `operation-${++next}`,
    now: () => now,
    ttlMs: 100,
  });
  const id = store.getOrCreate("variant-1", "quantity:1");
  store.markAttempt("variant-1", id);
  now = 1_101;

  assert.throws(
    () => store.getOrCreate("variant-1", "quantity:1"),
    (error: unknown) => error instanceof InventoryOperationStateError && error.code === "OPERATION_EXPIRED_UNKNOWN",
  );
  store.cancel("variant-1");
  assert.equal(store.getOrCreate("variant-1", "quantity:1"), "operation-2");
});

test("separate browser tabs use independent session storage records", () => {
  let next = 0;
  const options = { createId: () => `operation-${++next}`, now: () => 1_000, ttlMs: 10_000 };
  const tabOne = new InventoryOperationIdStore("quick-sell", new MemoryStorage(), options);
  const tabTwo = new InventoryOperationIdStore("quick-sell", new MemoryStorage(), options);

  assert.notEqual(
    tabOne.getOrCreate("variant-1", "quantity:1"),
    tabTwo.getOrCreate("variant-1", "quantity:1"),
  );
});
