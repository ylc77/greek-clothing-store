import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { PosOperationIdStore, type PosOperationStorage } from "../lib/pos-operation-id.ts";

class MemoryStorage implements PosOperationStorage {
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

function store() {
  let next = 0;
  const storage = new MemoryStorage();
  return {
    storage,
    ids: new PosOperationIdStore(storage, () => `operation-${++next}`),
  };
}

test("one checkout confirmation keeps one business ID across clicks and retries", () => {
  const { ids } = store();
  const first = ids.getOrCreate("checkout", "cart-a");
  const doubleClick = ids.getOrCreate("checkout", "cart-a");
  const networkRetry = ids.getOrCreate("checkout", "cart-a");

  assert.equal(first, "operation-1");
  assert.equal(doubleClick, first);
  assert.equal(networkRetry, first);
});

test("response loss survives a new store instance backed by the same session storage", () => {
  let next = 0;
  const storage = new MemoryStorage();
  const beforeLoss = new PosOperationIdStore(storage, () => `operation-${++next}`);
  const id = beforeLoss.getOrCreate("checkout", "cart-a");
  const afterLoss = new PosOperationIdStore(storage, () => `operation-${++next}`);

  assert.equal(afterLoss.getOrCreate("checkout", "cart-a"), id);
  assert.equal(next, 1);
});

test("only success or explicit cancellation clears an operation", () => {
  const { ids } = store();
  const first = ids.getOrCreate("void:order-1", "order-1");

  ids.markUncertain("void:order-1", first);
  assert.equal(ids.getOrCreate("void:order-1", "order-1"), first);

  ids.complete("void:order-1", first);
  assert.equal(ids.getOrCreate("void:order-1", "order-1"), "operation-2");

  ids.cancel("void:order-1");
  assert.equal(ids.getOrCreate("void:order-1", "order-1"), "operation-3");
});

test("a changed business payload starts a new operation and stale success cannot clear it", () => {
  const { ids } = store();
  const first = ids.getOrCreate("checkout", "cart-a");
  const second = ids.getOrCreate("checkout", "cart-b");

  assert.notEqual(second, first);
  ids.complete("checkout", first);
  assert.equal(ids.getOrCreate("checkout", "cart-b"), second);
});

test("checkout and each void order have isolated operation scopes", () => {
  const { ids } = store();
  const checkout = ids.getOrCreate("checkout", "cart-a");
  const voidOne = ids.getOrCreate("void:order-1", "order-1");
  const voidTwo = ids.getOrCreate("void:order-2", "order-2");

  assert.equal(checkout, "operation-1");
  assert.equal(voidOne, "operation-2");
  assert.equal(voidTwo, "operation-3");
});
