import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const migrations = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const boundaryMigrations = migrations.filter((name) => /^\d+_restrict_public_product_data\.sql$/.test(name));

assert.equal(boundaryMigrations.length, 1, "expected exactly one public product data boundary migration");
const boundaryMigrationName = boundaryMigrations[0];
const boundaryVersion = BigInt(boundaryMigrationName.split("_", 1)[0]);
assert.ok(boundaryVersion > 20260716100000n, "public data migration must sort after CSV import migration");

const migration = read(`supabase/migrations/${boundaryMigrationName}`);
assert.match(migration, /revoke\s+select\s+on\s+table\s+public\.products\s+from\s+anon\s*,\s*authenticated/i);
assert.match(migration, /grant\s+select\s*\([\s\S]*?\)\s+on\s+table\s+public\.products\s+to\s+anon\s*,\s*authenticated/i);
assert.doesNotMatch(migration, /grant\s+select\s+on\s+(?:table\s+)?public\.products\s+to\s+(?:anon|authenticated)/i);
for (const restricted of [
  "name_cn",
  "description_cn",
  "barcode",
  "supplier_id",
  "supplier_style_code",
  "metadata_version",
  "structure_version",
  "create_model_version",
]) {
  const grantMatch = migration.match(/grant\s+select\s*\(([\s\S]*?)\)\s+on\s+table\s+public\.products\s+to\s+anon\s*,\s*authenticated/i);
  assert.ok(grantMatch, "public product column grant is missing");
  const grantedColumns = grantMatch[1].split(",").map((column) => column.trim().replaceAll('"', ""));
  assert.equal(grantedColumns.includes(restricted), false, `public migration grants restricted column ${restricted}`);
}

const productPage = read("app/product/[sku]/page.tsx");
assert.match(productPage, /serializeJsonForHtmlScript/);
assert.doesNotMatch(
  productPage,
  /dangerouslySetInnerHTML\s*=\s*\{\{[\s\S]{0,300}?__html:\s*JSON\.stringify/,
  "JSON-LD must not insert raw JSON.stringify output into an HTML script",
);

const publicBoundary = read("lib/product-data-boundary.ts");
for (const exportName of [
  "PUBLIC_PRODUCT_LIST_SELECT",
  "PUBLIC_PRODUCT_DETAIL_SELECT",
  "AI_PRODUCT_SELECT",
  "SKROUTZ_PRODUCT_SELECT",
  "SITEMAP_PRODUCT_SELECT",
]) {
  assert.match(publicBoundary, new RegExp(`export const ${exportName}`), `${exportName} is missing`);
}
for (const restricted of ["name_cn", "description_cn", "barcode", "supplier_id", "supplier_style_code"]) {
  const publicGrantBlock = publicBoundary.slice(
    publicBoundary.indexOf("PUBLIC_PRODUCT_COLUMN_GRANT_COLUMNS"),
    publicBoundary.indexOf("PUBLIC_PRODUCT_LIST_COLUMNS"),
  );
  assert.doesNotMatch(publicGrantBlock, new RegExp(`["']${restricted}["']`), `public DTO grant leaked ${restricted}`);
}

const publicConsumers = [
  ["lib/products.ts", ["PUBLIC_PRODUCT_LIST_SELECT", "PUBLIC_PRODUCT_DETAIL_SELECT"]],
  ["lib/feed.ts", ["SKROUTZ_PRODUCT_SELECT"]],
  ["app/api/ai-shop-assistant/route.ts", ["AI_PRODUCT_SELECT"]],
  ["app/sitemap.xml/route.ts", ["SITEMAP_PRODUCT_SELECT"]],
];
for (const [relativePath, imports] of publicConsumers) {
  const source = read(relativePath);
  assert.doesNotMatch(source, /\.select\(\s*["']\*["']/, `${relativePath} must not use select(*)`);
  for (const imported of imports) assert.match(source, new RegExp(`\\b${imported}\\b`), `${relativePath} must use ${imported}`);
}

const adminBoundary = read("lib/admin-data-boundary.ts");
assert.match(adminBoundary, /private, no-store, max-age=0/);
for (const sourcePath of [
  "app/api/admin/products/route.ts",
  "app/api/admin/inventory/route.ts",
  "app/api/admin/suppliers/route.ts",
]) {
  const source = read(sourcePath);
  assert.match(source, /adminPrivateJson|applyAdminPrivateCache/, `${sourcePath} must set private no-store responses`);
}

const suppliersRoute = read("app/api/admin/suppliers/route.ts");
assert.match(suppliersRoute, /procurement:read/);
assert.match(suppliersRoute, /procurement:write/);
assert.doesNotMatch(suppliersRoute, /\.select\(\s*["']\*["']/, "supplier API must use an explicit server-side select");

const adminAuth = read("lib/admin-auth.ts");
assert.match(adminAuth, /procurement:read/);
assert.match(adminAuth, /procurement:cost/);
assert.match(adminAuth, /procurement:write/);

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
  read(`supabase/migrations/${name}`),
  `-- END MIGRATION: ${name}`,
  "",
].join("\n"));
const expectedSnapshot = `${headerLines.join("\n")}\n${snapshotParts.join("\n")}`;
assert.equal(read("supabase/client-init.sql"), expectedSnapshot, "client-init.sql drifted from migrations");

console.log(`Public data static gates passed for ${boundaryMigrationName}.`);
