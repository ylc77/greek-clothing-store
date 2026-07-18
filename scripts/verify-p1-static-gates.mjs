import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const clientInitPath = path.join(root, "supabase", "client-init.sql");
const migrations = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const expectedP1Order = [
  "20260715100000_harden_pos_checkout_rpc.sql",
  "20260715100001_reconcile_pos_void_rpc.sql",
  "20260715102000_transactional_inventory_operations.sql",
  "20260715110000_harden_developer_credentials.sql",
];

assert.ok(migrations.length > 0, "migration directory must not be empty");
assert.equal(new Set(migrations).size, migrations.length, "migration names must be unique");
assert.equal(migrations.includes("20260714234237_transactional_inventory_operations.sql"), false, "unpublished out-of-order migration name remains");
let previousIndex = -1;
for (const name of expectedP1Order) {
  const index = migrations.indexOf(name);
  assert.ok(index > previousIndex, `${name} is missing or out of order`);
  previousIndex = index;
}

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
const parts = migrations.map((name) => [
  "-- ============================================================================",
  `-- BEGIN MIGRATION: ${name}`,
  "-- ============================================================================",
  fs.readFileSync(path.join(migrationsDirectory, name), "utf8"),
  `-- END MIGRATION: ${name}`,
  "",
].join("\n"));
const expectedSnapshot = `${headerLines.join("\n")}\n${parts.join("\n")}`;
assert.equal(
  normalizeLineEndings(fs.readFileSync(clientInitPath, "utf8")),
  normalizeLineEndings(expectedSnapshot),
  "client-init.sql has drifted from the ordered migration chain",
);

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
const trackedEnv = tracked.filter((name) => /(^|\/)\.env(?:\.|$)/.test(name) && name !== ".env.example");
assert.deepEqual(trackedEnv, [], `tracked environment files are forbidden: ${trackedEnv.join(", ")}`);

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const checkout = read("app/api/admin/pos/checkout/route.ts");
const voidRoute = read("app/api/admin/pos/orders/[id]/void/route.ts");
const inventoryAdjust = read("app/api/admin/inventory/adjust/route.ts");
const quickSell = read("app/api/admin/products/sell/route.ts");
const inventoryLibrary = read("lib/erp-inventory.ts");
const adminDashboard = read("components/admin-dashboard.tsx");

assert.match(checkout, /rpc\("pos_checkout_rpc"/);
assert.doesNotMatch(checkout, /\.from\("(?:sales_orders|sales_order_items|payments|stock_movements)"\)/);
assert.match(voidRoute, /rpc\("pos_void_rpc"/);
assert.doesNotMatch(voidRoute, /\.from\("(?:sales_orders|payments|inventory_balances|stock_movements)"\)/);
assert.match(inventoryAdjust, /rpc\("inventory_apply_rpc"/);
assert.match(quickSell, /rpc\("inventory_apply_rpc"/);
for (const route of [inventoryAdjust, quickSell]) {
  assert.doesNotMatch(route, /\.from\("(?:inventory_balances|stock_movements|inventory_operations)"\)/);
}
assert.doesNotMatch(inventoryLibrary, /adjustInventoryVariant|syncLegacyStockFromErp/);
assert.match(
  adminDashboard,
  /const operationScope = `void:\$\{order\.id\}`;[\s\S]*?clientRequestId: operationId,/,
  "POS void requests must reuse the persisted business operation ID",
);
assert.doesNotMatch(
  adminDashboard,
  /\/api\/admin\/pos\/orders\/\$\{order\.id\}\/void[\s\S]{0,300}clientRequestId: crypto\.randomUUID\(\)/,
  "POS void requests must not replace the persisted operation ID",
);

const gateChecks = [
  ["app/api/admin/pos/checkout/route.ts", /isFeatureEnabled\("pos_checkout"\)/],
  ["app/api/admin/pos/orders/[id]/void/route.ts", /isFeatureEnabled\("pos_void"\)/],
  ["app/api/admin/inventory/adjust/route.ts", /isFeatureEnabledUncached\("inventory"\)/],
  ["app/api/admin/products/sell/route.ts", /isFeatureEnabledUncached\("quick_sell"\)/],
  ["app/api/ai-shop-assistant/route.ts", /isFeatureEnabled\("ai_tools"\)/],
  ["app/feed.xml/route.ts", /isFeatureEnabled\("skroutz_feed"\)/],
  ["lib/admin-auth.ts", /isFeatureEnabled\("staff_accounts"\)/],
];
for (const [file, pattern] of gateChecks) assert.match(read(file), pattern, `${file} is missing its server-side feature gate`);

const deploymentText = [read("README.md"), read("agents.md"), read("docs/maintenance-zh.md")].join("\n");
assert.doesNotMatch(deploymentText, /20260714234237_transactional_inventory_operations|--include-all/);

console.log(`P1 static gates passed: ${migrations.length} ordered migrations, exact client-init snapshot, no tracked local env or non-transactional runtime fallback.`);
