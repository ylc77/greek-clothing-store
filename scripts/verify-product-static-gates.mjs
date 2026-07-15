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

assert.match(postHandler, /rpc\(\s*["']product_create_rpc["']/, "product POST must use product_create_rpc");
assert.match(putHandler, /rpc\(\s*["']product_update_rpc["']/, "product PUT must use product_update_rpc");

for (const [label, source] of [["POST", postHandler], ["PUT", putHandler]]) {
  assert.match(source, /USE_PRODUCT_RPC/, `${label} must enforce USE_PRODUCT_RPC`);
  assert.match(source, /503/, `${label} must fail closed with HTTP 503 when the product RPC is unavailable`);
  assert.match(
    source,
    /PRODUCT_(?:RPC|RUNTIME)[A-Z0-9_]*/,
    `${label} must return a stable product RPC configuration or availability error code`,
  );
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

assert.match(envExample, /^USE_PRODUCT_RPC=true$/m, ".env.example must enable transactional product RPCs by default");

console.log(
  `Product static gates passed: ${productMigration} is ordered, client-init is exact, and product POST/PUT are RPC-only and fail closed.`,
);
