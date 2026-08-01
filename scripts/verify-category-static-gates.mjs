import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

const migration = read("supabase/migrations/20260801191232_transactional_category_catalog.sql");
for (const marker of [
  "category_catalog_apply_rpc",
  "security definer",
  "set search_path = ''",
  "CATEGORY_IN_USE",
  "SUBCATEGORY_IN_USE",
  "CATEGORY_SLUG_IMMUTABLE",
  "SUBCATEGORY_IDENTITY_IMMUTABLE",
  "ACTIVE_CATEGORY_REQUIRED",
  "grant execute on function public.category_catalog_apply_rpc",
]) assert.ok(migration.toLowerCase().includes(marker.toLowerCase()), `category migration is missing ${marker}`);
assert.match(migration, /revoke all on function public\.category_catalog_apply_rpc\(jsonb, jsonb, uuid\[\], uuid\[\]\) from public, anon, authenticated/);

const legacyTimestampMigration = read("supabase/migrations/20260802103000_repair_legacy_category_timestamps.sql");
for (const marker of [
  "add column if not exists updated_at",
  "alter column updated_at set default",
  "alter column updated_at set not null",
  "categories_updated_at",
  "subcategories_updated_at",
  "create or replace function public.set_updated_at()",
  "set search_path = ''",
]) assert.ok(legacyTimestampMigration.toLowerCase().includes(marker.toLowerCase()), `legacy category timestamp migration is missing ${marker}`);
assert.match(legacyTimestampMigration, /update\s+public\.product_categories[\s\S]*?where\s+updated_at\s+is\s+null/i);
assert.match(legacyTimestampMigration, /update\s+public\.product_subcategories[\s\S]*?where\s+updated_at\s+is\s+null/i);

const route = read("app/api/admin/categories/route.ts");
assert.match(route, /authorizeAdminRequest\(request, permission\)/);
assert.match(route, /isFeatureEnabled\("product_management"\)/);
assert.match(route, /parseCategoryCatalogMutation/);
assert.match(route, /\.rpc\("category_catalog_apply_rpc"/);
assert.match(route, /if \(result\.error\) return databaseError/);
assert.match(route, /CATEGORY_RPC_UNAVAILABLE/);
assert.match(route, /CATEGORY_IN_USE/);
assert.match(route, /SUBCATEGORY_IN_USE/);
assert.match(route, /\[categories\] failed to load catalog/);
const putFlow = route.slice(route.indexOf("export async function PUT"));
assert.doesNotMatch(putFlow, /\.from\("product_categories"\)\.(?:insert|upsert|update|delete)/);
assert.doesNotMatch(putFlow, /\.from\("product_subcategories"\)\.(?:insert|upsert|update|delete)/);

const dashboard = read("components/admin-dashboard.tsx");
assert.match(dashboard, /crypto\.randomUUID\(\)/);
assert.match(dashboard, /deletedCategoryIds/);
assert.match(dashboard, /deletedSubcategoryIds/);
assert.match(dashboard, /parseCategoryCatalogMutation/);
assert.match(dashboard, /if \(!response\.ok\) throw new Error\(data\.error/);
assert.match(dashboard, /仍被商品使用的分类不能删除/);
assert.match(dashboard, /一次数据库事务中提交/);

const integrationTest = read("scripts/category-catalog-integration-test.mjs");
assert.match(integrationTest, /process\.platform === "win32"[\s\S]*?npx\.cmd supabase status -o env/);

const packageJson = read("package.json");
assert.match(packageJson, /test:category-install-paths/);

const ciWorkflow = read(".github/workflows/p1-remediation-gate.yml");
assert.match(ciWorkflow, /npm run test:category-install-paths/);

console.log("Category catalog static gates passed: strict input, RPC-only writes, legacy timestamps, in-use delete protection and explicit UI errors.");
