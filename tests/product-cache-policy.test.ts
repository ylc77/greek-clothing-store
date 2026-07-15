import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { finalizeCommittedProductMutation } from "../lib/product-cache-policy.ts";

test("a committed product mutation remains successful when cache invalidation succeeds", async () => {
  const committed = { productId: 17, operationId: "operation-1", replayed: false };
  let invalidations = 0;

  const outcome = await finalizeCommittedProductMutation(committed, async () => {
    invalidations += 1;
  });

  assert.equal(outcome.committed, true);
  assert.equal(outcome.value, committed);
  assert.equal(outcome.cacheWarning, null);
  assert.equal(invalidations, 1);
});

test("cache invalidation failure after commit returns a warning without pretending the database write failed", async () => {
  const committed = { productId: 17, operationId: "operation-1", replayed: false };

  const outcome = await finalizeCommittedProductMutation(committed, async () => {
    throw new Error("Next cache backend unavailable");
  });

  assert.equal(outcome.committed, true);
  assert.equal(outcome.value, committed);
  assert.deepEqual(outcome.cacheWarning, {
    code: "PRODUCT_CACHE_INVALIDATION_FAILED",
    message: "商品已保存，但页面缓存刷新失败，请刷新页面核对最新数据。",
  });
});

test("cache warning never exposes the raw invalidation exception", async () => {
  const secretDiagnostic = "cache failure containing internal-token-value";

  const outcome = await finalizeCommittedProductMutation({ productId: 17 }, () => {
    throw new Error(secretDiagnostic);
  });

  assert.equal(outcome.committed, true);
  assert.equal(outcome.cacheWarning?.code, "PRODUCT_CACHE_INVALIDATION_FAILED");
  assert.doesNotMatch(JSON.stringify(outcome), /internal-token-value/);
});
