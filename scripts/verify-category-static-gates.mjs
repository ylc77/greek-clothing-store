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

const route = read("app/api/admin/categories/route.ts");
assert.match(route, /authorizeAdminRequest\(request, permission\)/);
assert.match(route, /isFeatureEnabled\("product_management"\)/);
assert.match(route, /parseCategoryCatalogMutation/);
assert.match(route, /\.rpc\("category_catalog_apply_rpc"/);
assert.match(route, /if \(result\.error\) return databaseError/);
assert.match(route, /CATEGORY_RPC_UNAVAILABLE/);
assert.match(route, /CATEGORY_IN_USE/);
assert.match(route, /SUBCATEGORY_IN_USE/);
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

console.log("Category catalog static gates passed: strict input, RPC-only writes, in-use delete protection and explicit UI errors.");
