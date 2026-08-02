import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { CheckoutOperationStore } from "../lib/checkout-operation.ts";

class MemoryStorage {
  private value = new Map<string, string>();
  getItem(key: string) { return this.value.get(key) ?? null; }
  setItem(key: string, value: string) { this.value.set(key, value); }
  removeItem(key: string) { this.value.delete(key); }
}

test("checkout retries reuse the same operation ID and access token", () => {
  const store = new CheckoutOperationStore(new MemoryStorage());
  const first = store.getOrCreate("payload-a");
  const retry = store.getOrCreate("payload-a");
  assert.deepEqual(retry, first);
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.match(first.accessToken, /^[A-Za-z0-9_-]{43}$/);
});

test("a changed business payload starts a new operation", () => {
  const store = new CheckoutOperationStore(new MemoryStorage());
  const first = store.getOrCreate("payload-a");
  const next = store.getOrCreate("payload-b");
  assert.notEqual(next.id, first.id);
  assert.notEqual(next.accessToken, first.accessToken);
});

test("only successful completion of the current operation clears retry state", () => {
  const store = new CheckoutOperationStore(new MemoryStorage());
  const current = store.getOrCreate("payload-a");
  store.complete("another-id");
  assert.deepEqual(store.getOrCreate("payload-a"), current);
  store.complete(current.id);
  assert.notEqual(store.getOrCreate("payload-a").id, current.id);
});
