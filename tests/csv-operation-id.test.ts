import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { CsvImportOperationIdStore, CsvImportOperationStateError, createCsvImportFingerprint, type CsvImportOperationStorage } from "../lib/csv-operation-id.ts";

class MemoryStorage implements CsvImportOperationStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class DisabledStorage implements CsvImportOperationStorage {
  getItem() { return null; }
  setItem() { throw new Error("storage disabled"); }
  removeItem() { throw new Error("storage disabled"); }
}

function fixture(now = 1_000) {
  let next = 0;
  const storage = new MemoryStorage();
  const options = { createId: () => `import-${++next}`, now: () => now, ttlMs: 100 };
  return { storage, options, store: new CsvImportOperationIdStore("product-csv", storage, options), next: () => next };
}

test("fingerprint is canonical for object keys but includes modes and final translated row payload", () => {
  const first = createCsvImportFingerprint({ importMode: "create_only", inventoryMode: "metadata_only", rows: [{ sku: "dress-1", name_en: "Dress", metadata: { price: 10, color: "red" } }] });
  const same = createCsvImportFingerprint({ rows: [{ metadata: { color: "red", price: 10 }, name_en: "Dress", sku: "dress-1" }], inventoryMode: "metadata_only", importMode: "create_only" });
  const translatedDifferently = createCsvImportFingerprint({ importMode: "create_only", inventoryMode: "metadata_only", rows: [{ sku: "dress-1", name_en: "Summer dress", metadata: { price: 10, color: "red" } }] });
  const inventoryModeChanged = createCsvImportFingerprint({ importMode: "create_only", inventoryMode: "set_inventory", rows: [{ sku: "dress-1", name_en: "Dress", metadata: { price: 10, color: "red" } }] });
  assert.equal(same, first);
  assert.notEqual(translatedDifferently, first);
  assert.notEqual(inventoryModeChanged, first);
});

test("double click, timeout, 503, and response loss reuse one operation ID", () => {
  const { store, next } = fixture();
  const id = store.getOrCreate("fingerprint-1");
  store.markAttempt(id);
  assert.equal(store.getOrCreate("fingerprint-1"), id);
  assert.equal(store.getOrCreate("fingerprint-1"), id);
  assert.equal(next(), 1);
});

test("an attempted import survives refresh and can recover the persistent Job", () => {
  const { storage, options, store } = fixture();
  const id = store.getOrCreate("fingerprint-1");
  store.markAttempt(id);
  store.attachJob(id, "job-17");
  const refreshed = new CsvImportOperationIdStore("product-csv", storage, options);
  assert.deepEqual(refreshed.getPending(), { operationId: id, fingerprint: "fingerprint-1", jobId: "job-17", attempted: true });
  assert.equal(refreshed.getOrCreate("fingerprint-1"), id);
});

test("only success, known-no-write rejection, or explicit cancel clears the operation", () => {
  const { store } = fixture();
  const first = store.getOrCreate("fingerprint-1");
  store.markAttempt(first);
  store.complete(first);
  assert.equal(store.getOrCreate("fingerprint-1"), "import-2");

  const second = store.getOrCreate("fingerprint-2");
  store.discardKnownNoWrite(second);
  assert.equal(store.getOrCreate("fingerprint-2"), "import-4");

  store.cancel();
  assert.equal(store.getOrCreate("fingerprint-3"), "import-5");
});

test("selecting a new file before submit replaces an unused ID, but after submit fails closed", () => {
  const { store } = fixture();
  const unused = store.getOrCreate("file-a");
  const replacement = store.getOrCreate("file-b");
  assert.notEqual(replacement, unused);
  store.markAttempt(replacement);
  assert.throws(
    () => store.getOrCreate("file-c"),
    (error: unknown) => error instanceof CsvImportOperationStateError && error.code === "OPERATION_PENDING_DIFFERENT_INPUT",
  );
});

test("corrupt or unavailable persisted state blocks a new write", () => {
  const { storage, store } = fixture();
  storage.values.set(store.storageKeyForTest(), "{bad-json");
  assert.throws(() => store.getOrCreate("file-a"), (error: unknown) => error instanceof CsvImportOperationStateError && error.code === "OPERATION_STATE_CORRUPT");

  const unavailable = new CsvImportOperationIdStore("disabled", new DisabledStorage(), { createId: () => "id", now: () => 1_000, ttlMs: 10 });
  assert.throws(() => unavailable.getOrCreate("file-a"), (error: unknown) => error instanceof CsvImportOperationStateError && error.code === "OPERATION_STORAGE_UNAVAILABLE");
});

test("an attempted persistent Job remains recoverable after TTL while an unused ID can expire", () => {
  let now = 1_000;
  let next = 0;
  const storage = new MemoryStorage();
  const store = new CsvImportOperationIdStore("expiry", storage, { createId: () => `id-${++next}`, now: () => now, ttlMs: 10 });
  const unused = store.getOrCreate("file-unused");
  now = 1_011;
  assert.notEqual(store.getOrCreate("file-next"), unused);

  const attempted = store.getOrCreate("file-attempted");
  store.markAttempt(attempted);
  store.attachJob(attempted, "job-persistent");
  now = 2_000;
  assert.deepEqual(store.getPending(), {
    operationId: attempted,
    fingerprint: "file-attempted",
    jobId: "job-persistent",
    attempted: true,
  });
  assert.equal(store.getOrCreate("file-attempted"), attempted);
});
