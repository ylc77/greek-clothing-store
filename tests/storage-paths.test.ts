import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryStoragePath,
  normalizeStorageObjectPath,
  pathBelongsToProduct,
  productStoragePath,
  productStoragePrefix,
  settingsStoragePath,
  storagePathFromPublicUrl,
} from "../lib/storage-images.ts";

const operationId = "11111111-2222-4333-8444-555555555555";

test("product paths are stable, isolated by product id, and collision resistant", () => {
  const slash = productStoragePrefix(42, "SKU/A");
  const question = productStoragePrefix(42, "SKU?A");
  const otherProduct = productStoragePrefix(43, "SKU/A");
  assert.notEqual(slash, question);
  assert.notEqual(slash, otherProduct);
  assert.match(slash, /^products\/42\/[a-zA-Z0-9._-]+-[a-f0-9]{12}$/);

  const main = productStoragePath(42, "SKU/A", "main", operationId);
  const gallery = productStoragePath(42, "SKU/A", "gallery", operationId);
  assert.ok(pathBelongsToProduct(main, 42, "SKU/A"));
  assert.ok(pathBelongsToProduct(gallery, 42, "SKU/A"));
  assert.equal(pathBelongsToProduct(main, 43, "SKU/A"), false);
});

test("settings and category paths use strict targets and opaque operation ids", () => {
  assert.equal(settingsStoragePath("logo", operationId), `store/logo/${operationId}.webp`);
  assert.equal(settingsStoragePath("hero", operationId), `store/hero/${operationId}.webp`);
  assert.equal(categoryStoragePath("79ba3c9f-5962-48bc-9f93-9dab3af04120", operationId), `categories/79ba3c9f-5962-48bc-9f93-9dab3af04120/${operationId}.webp`);
  assert.throws(() => settingsStoragePath("../logo" as "logo", operationId));
  assert.throws(() => categoryStoragePath("../other", operationId));
});

test("storage paths reject traversal, separators, controls, and foreign origins", () => {
  for (const value of ["../secret", "products/x/../../secret", "products\\x\\main.webp", "/absolute", "products//x", "products/x/\u0000.webp"]) {
    assert.throws(() => normalizeStorageObjectPath(value), `accepted ${JSON.stringify(value)}`);
  }

  const origin = "https://example.supabase.co";
  const path = productStoragePath(42, "SKU/A", "main", operationId);
  const url = `${origin}/storage/v1/object/public/product-images/${encodeURI(path)}?v=1`;
  assert.equal(storagePathFromPublicUrl(url, origin), path);
  assert.equal(storagePathFromPublicUrl(url, "https://other.supabase.co"), null);
  assert.equal(storagePathFromPublicUrl(`https://evil.example/storage/v1/object/public/product-images/${path}`, origin), null);
  assert.equal(storagePathFromPublicUrl(`${origin}/storage/v1/object/public/product-images/products/x/%2e%2e/secret`, origin), null);
});

