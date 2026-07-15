import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migrationsDirectory = path.join(root, "supabase", "migrations");
const clientInitPath = path.join(root, "supabase", "client-init.sql");
const migrations = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const productMigrations = migrations.filter((name) => /^\d+_transactional_product_operations\.sql$/.test(name));

assert.equal(productMigrations.length, 1, "expected exactly one transactional product operations migration");
const productMigration = productMigrations[0];
const productMigrationVersion = productMigration.split("_", 1)[0];
assert.ok(
  BigInt(productMigrationVersion) > 20260715110000n,
  "transactional product migration must sort after the P1 developer credential migration",
);

const headerLines = [
  "-- Clothing Store - new customer Supabase initialization",
  "-- AUTHORITATIVE NEW CUSTOMER DEPLOYMENT SNAPSHOT.",
  "-- Run this file only in a brand-new, empty Supabase project.",
  "-- For customer deployment: paste the whole file into Supabase SQL Editor and click Run once.",
  "-- For development and upgrades: supabase/migrations remains the source of truth.",
  "-- Do not run this file on an existing customer database.",
  "-- Generated from the ordered migrations listed below.",
  "",
];
const snapshotParts = migrations.map((name) => [
  "-- ============================================================================",
  `-- BEGIN MIGRATION: ${name}`,
  "-- ============================================================================",
  fs.readFileSync(path.join(migrationsDirectory, name), "utf8"),
  `-- END MIGRATION: ${name}`,
  "",
].join("\n"));
const expectedSnapshot = `${headerLines.join("\n")}\n${snapshotParts.join("\n")}`;
assert.equal(
  fs.readFileSync(clientInitPath, "utf8"),
  expectedSnapshot,
  "client-init.sql has drifted from the ordered migration chain",
);

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const createRoute = read("app/api/admin/products/route.ts");
const updateRoute = read("app/api/admin/products/[id]/route.ts");
const bulkRoute = read("app/api/admin/products/bulk/route.ts");
const dashboard = read("components/admin-dashboard.tsx");
const envExample = read(".env.example");

const handlerSource = (source, handlerName) => {
  const startMarker = `export async function ${handlerName}`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${handlerName} handler is missing`);
  const remaining = source.slice(start + startMarker.length);
  const nextHandlerOffset = remaining.search(/\nexport async function [A-Z]+/);
  return nextHandlerOffset >= 0
    ? source.slice(start, start + startMarker.length + nextHandlerOffset)
    : source.slice(start);
};

const postHandler = handlerSource(createRoute, "POST");
const putHandler = handlerSource(updateRoute, "PUT");
const deleteHandler = handlerSource(updateRoute, "DELETE");
const bulkPutHandler = handlerSource(bulkRoute, "PUT");

assert.match(createRoute, /rpc\(\s*["']product_create_rpc["']/, "product POST route must use product_create_rpc");
assert.match(updateRoute, /rpc\(\s*["']product_update_rpc["']/, "product update route must use product_update_rpc");
assert.match(putHandler, /executeUpdate\(/, "product PUT must use the shared transactional update executor");
assert.match(deleteHandler, /executeUpdate\(/, "product DELETE must use the shared transactional update executor");
assert.doesNotMatch(
  updateRoute,
  /productIdFromRpcResult\(rpcData\)\s*\|\|\s*productId/,
  "product update must not turn an unreadable RPC result into success by reloading the requested product",
);
assert.match(
  updateRoute,
  /resultProductId\s*!==\s*productId/,
  "product update must require the RPC result to identify the requested product",
);

for (const [label, source] of [["POST", postHandler], ["PUT", putHandler], ["DELETE", deleteHandler]]) {
  assert.match(source, /USE_PRODUCT_RPC/, `${label} must enforce USE_PRODUCT_RPC`);
  assert.match(source, /productRpcRequired\(/, `${label} must use the shared HTTP 503 fail-closed response`);
  assert.doesNotMatch(
    source,
    /\.from\(\s*["'](?:products|product_variants|inventory_balances|stock_movements|product_operations)["']\s*\)[\s\S]{0,160}?\.(?:insert|upsert|update|delete)\s*\(/,
    `${label} must not perform direct multi-table product or inventory writes`,
  );
  assert.doesNotMatch(
    source,
    /syncProductInventoryFromLegacy|syncProductVariantActiveState/,
    `${label} must not retain the historical Node.js inventory synchronization fallback`,
  );
}
for (const [label, source] of [["POST route", createRoute], ["update route", updateRoute]]) {
  assert.match(source, /503/, `${label} must define an HTTP 503 product RPC failure response`);
  assert.match(
    source,
    /PRODUCT_(?:RPC|RUNTIME)[A-Z0-9_]*/,
    `${label} must define a stable product RPC configuration or availability error code`,
  );
}

assert.match(
  bulkPutHandler,
  /rpc\(\s*["']product_bulk_status_rpc["']/,
  "bulk product status must use one transactional product_bulk_status_rpc call",
);
assert.match(bulkPutHandler, /USE_PRODUCT_RPC/, "bulk product status must enforce USE_PRODUCT_RPC");
assert.match(bulkPutHandler, /503/, "bulk product status must fail closed with HTTP 503");
assert.match(
  bulkPutHandler,
  /PRODUCT_(?:RPC|RUNTIME)[A-Z0-9_]*/,
  "bulk product status must return a stable product RPC availability error code",
);
assert.doesNotMatch(
  bulkRoute,
  /\.from\(\s*["'](?:products|product_variants|inventory_balances|stock_movements|product_operations)["']\s*\)[\s\S]{0,160}?\.(?:insert|upsert|update|delete)\s*\(/,
  "bulk product status must not directly write product or inventory tables",
);
assert.doesNotMatch(
  bulkRoute,
  /syncProductInventoryFromLegacy|syncProductVariantActiveFromLegacy|syncProductVariantActiveState/,
  "bulk product status must not retain a historical Node.js synchronization fallback",
);
assert.doesNotMatch(
  bulkRoute,
  /product_update_rpc|Promise\.all/,
  "bulk product status must not loop or fan out product_update_rpc calls in Node.js",
);
assert.equal(
  (bulkRoute.match(/\.rpc\s*\(/g) || []).length,
  1,
  "bulk product status must invoke exactly one database RPC",
);
assert.match(
  bulkRoute,
  /bulkProductResultFromRpcResult\(rpcData/,
  "bulk product status must validate the committed RPC result envelope before returning success",
);
assert.doesNotMatch(
  bulkRoute,
  /finalized\.value\s*&&\s*typeof finalized\.value === ["']object["'][\s\S]{0,100}:\s*\{\}/,
  "bulk product status must not coerce an unreadable RPC result into an empty success",
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing dashboard marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing dashboard marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function assertProductOperationLifecycle(label, source) {
  assert.match(source, /productOperationIds\(\)\.getOrCreate\(/, `${label} must create or reuse one product operation ID`);
  assert.match(source, /productOperationIds\(\)\.markAttempt\(/, `${label} must mark the ID before its write request`);
  assert.match(source, /productOperationIds\(\)\.complete\(/, `${label} must clear the ID only after success`);
  assert.match(source, /handleProductOperationFailure\(/, `${label} must preserve or safely discard the ID after failure`);
}

const metadataSave = sourceBetween(dashboard, "  async function saveProductMetadata(", "  function addSize(");
const editorSave = sourceBetween(dashboard, "  async function doSubmit()", "  function confirmDeleteProduct(");
const archiveProduct = sourceBetween(dashboard, "  async function executeDelete(", "  function confirmRestoreProduct(");
const restoreProduct = sourceBetween(dashboard, "  async function executeRestore(", "  async function permanentDelete(");
const bulkStatus = sourceBetween(dashboard, "  async function executeBatch(", "  async function batchGenerateAiMeta(");
const quickAdd = sourceBetween(dashboard, "  async function submitQuickAdd(", "  async function sellOne(");

assertProductOperationLifecycle("metadata and AI product edits", metadataSave);
assertProductOperationLifecycle("ordinary product create/edit", editorSave);
assertProductOperationLifecycle("single product archive", archiveProduct);
assertProductOperationLifecycle("bulk product status", bulkStatus);
assertProductOperationLifecycle("quick photo product creation", quickAdd);
assert.match(
  restoreProduct,
  /saveProductMetadata\([^;]*\{\s*is_active:\s*true\s*\}/,
  "single product restore must reuse the protected metadata operation lifecycle",
);
assert.match(editorSave, /clientRequestId:\s*operationId/, "ordinary product writes must send their stable operation ID");
assert.match(quickAdd, /clientRequestId:\s*operationId/, "quick photo creation must send its stable operation ID");
assert.match(bulkStatus, /clientRequestId:\s*operationId/, "bulk status must send its stable operation ID");

assert.ok(
  metadataSave.indexOf("try {") < metadataSave.indexOf("productOperationIds().getOrCreate("),
  "metadata/AI saves must catch operation-state failures so reconciliation reset remains available",
);
assert.match(
  editorSave,
  /productBasePriceChanged/,
  "ordinary edits must detect a base-price change and include POS-facing Variant price updates",
);
assert.match(
  editorSave,
  /if \(!r\.ok\)/,
  "ordinary create must report a top-level image upload HTTP failure after the product commits",
);
assert.match(
  quickAdd,
  /results\.some\(.*!.*\.ok/s,
  "quick photo create must report per-file image failures even when the upload endpoint returns HTTP 200",
);

assert.match(envExample, /^USE_PRODUCT_RPC=true$/m, ".env.example must enable transactional product RPCs by default");

console.log(
  `Product static gates passed: ${productMigration} is ordered, client-init is exact, product routes are RPC-only, and browser operation IDs survive retries.`,
);
