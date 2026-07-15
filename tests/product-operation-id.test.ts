import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { ProductOperationIdStore, ProductOperationStateError, createProductOperationFingerprint, type ProductOperationStorage } from "../lib/product-operation-id.ts";

class MemoryStorage implements ProductOperationStorage {
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

class DisabledStorage implements ProductOperationStorage {
  getItem() { return null; }
  setItem() { throw new Error("storage disabled"); }
  removeItem() { throw new Error("storage disabled"); }
}

class LyingStorage extends MemoryStorage {
  override setItem(_key: string, _value: string) {
    // Some privacy modes accept the call but do not persist the value.
  }
}

function fixture(now = 1_000) {
  let next = 0;
  const storage = new MemoryStorage();
  return {
    storage,
    store: new ProductOperationIdStore("product", storage, {
      createId: () => `operation-${++next}`,
      now: () => now,
      ttlMs: 100,
    }),
    next: () => next,
  };
}

test("product payload fingerprint is canonical for object keys and sensitive to business changes", () => {
  const first = createProductOperationFingerprint({
    sku: "DRESS-001",
    sizes: ["S", "M"],
    metadata: { name: "Dress", price: 39.9 },
  });
  const sameBusinessPayload = createProductOperationFingerprint({
    metadata: { price: 39.9, name: "Dress" },
    sizes: ["S", "M"],
    sku: "DRESS-001",
  });
  const changedQuantity = createProductOperationFingerprint({
    sku: "DRESS-001",
    sizes: ["S", "M"],
    metadata: { name: "Dress", price: 40.9 },
  });
  const changedSizeOrder = createProductOperationFingerprint({
    sku: "DRESS-001",
    sizes: ["M", "S"],
    metadata: { name: "Dress", price: 39.9 },
  });

  assert.equal(sameBusinessPayload, first);
  assert.notEqual(changedQuantity, first);
  assert.notEqual(changedSizeOrder, first);
});

test("double click and retry keep one product business ID for the same fingerprint", () => {
  const { store, next } = fixture();
  const fingerprint = createProductOperationFingerprint({ sku: "DRESS-001", sizes: ["S", "M"] });
  const first = store.getOrCreate("create", fingerprint);
  store.markAttempt("create", first);

  assert.equal(store.getOrCreate("create", fingerprint), first);
  assert.equal(store.getOrCreate("create", fingerprint), first);
  assert.equal(next(), 1);
});

test("response loss survives page refresh through session storage", () => {
  let next = 0;
  const storage = new MemoryStorage();
  const options = { createId: () => `operation-${++next}`, now: () => 1_000, ttlMs: 10_000 };
  const beforeLoss = new ProductOperationIdStore("product", storage, options);
  const fingerprint = createProductOperationFingerprint({ productId: 17, name: "Updated dress" });
  const id = beforeLoss.getOrCreate("update:17", fingerprint);
  beforeLoss.markAttempt("update:17", id);
  const afterRefresh = new ProductOperationIdStore("product", storage, options);

  assert.equal(afterRefresh.getOrCreate("update:17", fingerprint), id);
  assert.equal(next, 1);
});

test("success and an explicit known-no-write failure clear the operation", () => {
  const { store } = fixture();
  const createFingerprint = createProductOperationFingerprint({ sku: "DRESS-001" });
  const first = store.getOrCreate("create", createFingerprint);
  store.markAttempt("create", first);
  store.complete("create", first);
  assert.equal(store.getOrCreate("create", createFingerprint), "operation-2");

  const updateFingerprint = createProductOperationFingerprint({ productId: 17, name: "Dress" });
  const second = store.getOrCreate("update:17", updateFingerprint);
  store.markAttempt("update:17", second);
  store.discardKnownNoWrite("update:17", second);
  assert.equal(store.getOrCreate("update:17", updateFingerprint), "operation-4");
});

test("503 and network failures preserve an attempted ID for safe replay", () => {
  const { store, next } = fixture();
  const fingerprint = createProductOperationFingerprint({ sku: "DRESS-001", stock: 1 });
  const id = store.getOrCreate("create", fingerprint);
  store.markAttempt("create", id);

  // A 503 or thrown fetch error is an unknown outcome. The caller deliberately
  // does not call complete/discardKnownNoWrite in either case.
  assert.equal(store.getOrCreate("create", fingerprint), id, "503 retry must reuse the original ID");
  assert.equal(store.getOrCreate("create", fingerprint), id, "network retry must reuse the original ID");
  assert.equal(next(), 1);
});

test("changed input after an attempted request fails closed instead of creating a second write", () => {
  const { store } = fixture();
  const original = createProductOperationFingerprint({ productId: 17, stock: 2 });
  const changed = createProductOperationFingerprint({ productId: 17, stock: 3 });
  const id = store.getOrCreate("update:17", original);
  store.markAttempt("update:17", id);

  assert.throws(
    () => store.getOrCreate("update:17", changed),
    (error: unknown) => error instanceof ProductOperationStateError
      && error.code === "OPERATION_PENDING_DIFFERENT_INPUT",
  );
});

test("changed input before the first request replaces the unused ID and stale completion cannot clear it", () => {
  const { store } = fixture();
  const original = createProductOperationFingerprint({ productId: 17, name: "Draft" });
  const changed = createProductOperationFingerprint({ productId: 17, name: "Final" });
  const first = store.getOrCreate("update:17", original);
  const second = store.getOrCreate("update:17", changed);

  assert.notEqual(second, first);
  store.complete("update:17", first);
  assert.equal(store.getOrCreate("update:17", changed), second);
});

test("create and separate product edits use isolated operation scopes", () => {
  const { store } = fixture();
  const fingerprint = createProductOperationFingerprint({ name: "Dress" });

  const create = store.getOrCreate("create", fingerprint);
  const firstEdit = store.getOrCreate("update:17", fingerprint);
  const secondEdit = store.getOrCreate("update:18", fingerprint);

  assert.equal(create, "operation-1");
  assert.equal(firstEdit, "operation-2");
  assert.equal(secondEdit, "operation-3");
});

test("corrupt persisted state blocks writes until the user explicitly cancels", () => {
  const { storage, store } = fixture();
  storage.values.set(store.storageKeyForTest("update:17"), "{not-json");

  assert.throws(
    () => store.getOrCreate("update:17", "fingerprint"),
    (error: unknown) => error instanceof ProductOperationStateError
      && error.code === "OPERATION_STATE_CORRUPT",
  );
  store.cancel("update:17");
  assert.equal(store.getOrCreate("update:17", "fingerprint"), "operation-1");
});

test("disabled or non-persisting storage fails closed before any product request", () => {
  for (const storage of [new DisabledStorage(), new LyingStorage()]) {
    const store = new ProductOperationIdStore("product", storage, {
      createId: () => "operation-1",
      now: () => 1_000,
      ttlMs: 10_000,
    });

    assert.throws(
      () => store.getOrCreate("create", "fingerprint"),
      (error: unknown) => error instanceof ProductOperationStateError
        && error.code === "OPERATION_STORAGE_UNAVAILABLE",
    );
  }
});

test("expired attempted operations require reconciliation before a new ID", () => {
  let now = 1_000;
  let next = 0;
  const storage = new MemoryStorage();
  const store = new ProductOperationIdStore("product", storage, {
    createId: () => `operation-${++next}`,
    now: () => now,
    ttlMs: 100,
  });
  const id = store.getOrCreate("update:17", "fingerprint");
  store.markAttempt("update:17", id);
  now = 1_101;

  assert.throws(
    () => store.getOrCreate("update:17", "fingerprint"),
    (error: unknown) => error instanceof ProductOperationStateError
      && error.code === "OPERATION_EXPIRED_UNKNOWN",
  );
  store.cancel("update:17");
  assert.equal(store.getOrCreate("update:17", "fingerprint"), "operation-2");
});
