import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { detachAndDeleteStorageObject, uploadAndCommitStorageObject, type StorageLifecycleBackend, type StorageOperationStatus } from "../lib/storage-lifecycle.ts";

function fakeBackend(overrides: Partial<StorageLifecycleBackend> = {}) {
  const events: string[] = [];
  const statuses: StorageOperationStatus[] = [];
  const backend: StorageLifecycleBackend = {
    async prepare(input) { events.push(`prepare:${input.action}:${input.path}`); return { id: "op-1" }; },
    async setStatus(_id, status) { statuses.push(status); events.push(`status:${status}`); },
    async upload(input) { events.push(`upload:${input.path}`); },
    async remove(path) { events.push(`remove:${path}`); },
    ...overrides,
  };
  return { backend, events, statuses };
}

const object = {
  operationId: "11111111-2222-4333-8444-555555555555",
  bucket: "product-images",
  path: "products/42/example/main/11111111-2222-4333-8444-555555555555.webp",
  ownerType: "product",
  ownerKey: "42",
} as const;

test("Storage upload failure never commits a database reference", async () => {
  let committed = false;
  const { backend, statuses } = fakeBackend({ async upload() { throw new Error("storage down"); } });
  await assert.rejects(uploadAndCommitStorageObject({
    backend,
    object,
    body: Buffer.from("image"),
    contentType: "image/webp",
    commitReference: async () => { committed = true; },
  }));
  assert.equal(committed, false);
  assert.deepEqual(statuses, ["failed"]);
});

test("database commit failure compensates the newly uploaded object", async () => {
  const { backend, events, statuses } = fakeBackend();
  await assert.rejects(uploadAndCommitStorageObject({
    backend,
    object,
    body: Buffer.from("image"),
    contentType: "image/webp",
    commitReference: async () => { throw new Error("database rejected update"); },
  }));
  assert.ok(events.includes(`remove:${object.path}`));
  assert.deepEqual(statuses, ["storage_ready", "cleanup_pending", "compensated"]);
});

test("a failed compensation remains recoverable instead of being reported as committed", async () => {
  const { backend, statuses } = fakeBackend({ async remove() { throw new Error("storage delete failed"); } });
  await assert.rejects(uploadAndCommitStorageObject({
    backend,
    object,
    body: Buffer.from("image"),
    contentType: "image/webp",
    commitReference: async () => { throw new Error("database rejected update"); },
  }));
  assert.deepEqual(statuses, ["storage_ready", "cleanup_pending", "cleanup_pending"]);
});

test("reference removal is committed before object deletion and failed deletion remains queued", async () => {
  let referenceRemoved = false;
  const { backend, events, statuses } = fakeBackend({
    async remove(path) {
      assert.equal(referenceRemoved, true);
      events.push(`remove:${path}`);
      throw new Error("storage unavailable");
    },
  });
  const result = await detachAndDeleteStorageObject({
    backend,
    object: { ...object, operationId: "22222222-2222-4222-8222-222222222222" },
    removeReference: async () => { referenceRemoved = true; events.push("reference:removed"); },
  });
  assert.equal(result.cleanupPending, true);
  assert.deepEqual(statuses, ["reference_removed", "cleanup_pending"]);
});

test("database reference failure never deletes the live object", async () => {
  const { backend, events, statuses } = fakeBackend();
  await assert.rejects(detachAndDeleteStorageObject({
    backend,
    object: { ...object, operationId: "33333333-2222-4333-8333-333333333333" },
    removeReference: async () => { throw new Error("database unavailable"); },
  }));
  assert.equal(events.some((event) => event.startsWith("remove:")), false);
  assert.deepEqual(statuses, ["cancelled"]);
});
