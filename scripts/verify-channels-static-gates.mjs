import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const migrations = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();

const legalMigrations = migrations.filter((name) => /^\d+_transactional_legal_settings_publish\.sql$/.test(name));
assert.equal(legalMigrations.length, 1, "expected exactly one transactional legal publish migration");
assert.equal(legalMigrations[0], "20260718064715_transactional_legal_settings_publish.sql");
assert.ok(
  migrations.indexOf(legalMigrations[0]) > migrations.indexOf("20260716170000_ai_auth_abuse_protection.sql"),
  "legal publish migration must sort after the prior published migration chain",
);

const legalMigration = read(`supabase/migrations/${legalMigrations[0]}`);
for (const marker of [
  "security definer",
  "set search_path = ''",
  "pg_advisory_xact_lock",
  "revoke all on function public.legal_settings_publish_rpc(jsonb, text) from public, anon, authenticated",
  "grant execute on function public.legal_settings_publish_rpc(jsonb, text) to service_role",
]) assert.match(legalMigration.toLowerCase(), new RegExp(escapeRegExp(marker)));

const legalRoute = read("app/api/admin/legal-settings/route.ts");
const legalPost = legalRoute.slice(legalRoute.indexOf("export async function POST"));
assert.match(legalPost, /\.rpc\(\s*"legal_settings_publish_rpc"/);
assert.match(legalPost, /LEGAL_PUBLISH_UNAVAILABLE/);
assert.doesNotMatch(legalPost, /\.from\("legal_settings_versions"\)/);

const adminDashboard = read("components/admin-dashboard.tsx");
assert.match(adminDashboard, /OnlineOrdersManager/);
assert.match(adminDashboard, /onlineOrders/);
for (const retiredAdminMarker of [
  "Skroutz Feed 状态",
  "Skroutz URL",
  "可进 Skroutz",
  "skroutzReadinessIssues",
  "adminFeatures.skroutz_feed",
  'tab === "skroutz"',
]) {
  assert.doesNotMatch(
    adminDashboard,
    new RegExp(escapeRegExp(retiredAdminMarker)),
    `retired admin Skroutz surface returned: ${retiredAdminMarker}`,
  );
}
for (const [name, source] of [
  ["store settings page", read("app/admin/settings/page.tsx")],
  ["store settings API", read("app/api/admin/settings/route.ts")],
  ["feature catalog", read("lib/feature-catalog.ts")],
]) {
  assert.doesNotMatch(source, /skroutz_feed|enable_skroutz|feed_min_stock/i, `${name} still exposes retired Skroutz settings`);
}
const onlineOrderRoute = read("app/api/orders/route.ts");
const onlineOrderMigration = read("supabase/migrations/20260802120000_online_store_orders.sql");
for (const marker of ["USE_ONLINE_ORDER_RPC", "online_order_create_rpc", "AUTH_RATE_LIMIT_SECRET", "online_orders"]) {
  assert.match(onlineOrderRoute, new RegExp(marker));
}
for (const marker of ["security definer", "set search_path = ''", "for update of b", "quantity_reserved", "online_order_insufficient_stock"]) {
  assert.match(onlineOrderMigration.toLowerCase(), new RegExp(escapeRegExp(marker)));
}
assert.match(read("app/feed.xml/route.ts"), /status:\s*410/);

const homePage = read("app/page.tsx");
const siteHeader = read("components/site-header.tsx");
const categoryRoute = read("app/[category]/page.tsx");
const productPage = read("app/product/[sku]/page.tsx");
const sitemapRoute = read("app/sitemap.xml/route.ts");
for (const [name, source] of [
  ["homepage", homePage],
  ["site header", siteHeader],
  ["category route", categoryRoute],
  ["product page", productPage],
  ["sitemap", sitemapRoute],
]) {
  assert.match(source, /getStorefrontCategoryNavigation/, `${name} must use database-backed storefront categories`);
}
assert.doesNotMatch(homePage, /import\s*\{\s*categories\s*\}\s*from\s*["']@\/lib\/types["']/, "homepage must not import the fixed category list");
assert.doesNotMatch(siteHeader, /import\s*\{[^}]*\bcategories\b[^}]*\}\s*from\s*["']@\/lib\/types["']/, "site header must not import the fixed category list");
assert.doesNotMatch(sitemapRoute, /import\s*\{\s*categories\s*\}\s*from\s*["']@\/lib\/types["']/, "sitemap must not import the fixed category list");
assert.match(siteHeader, /splitDesktopCategoryNavigation/);
assert.match(siteHeader, /data-storefront-category-more/);

const monitor = read("scripts/site-smoke-check.js");
for (const marker of ["retired product feed", '"/cart"', '"/checkout"', "expected 410"]) {
  assert.match(monitor, new RegExp(escapeRegExp(marker)));
}
const monitorWorkflow = read(".github/workflows/site-monitor.yml");
assert.doesNotMatch(monitorWorkflow, /STRICT_FEED/);
for (const action of ["actions/checkout@v6", "actions/setup-node@v6", "actions/upload-artifact@v6"]) assert.match(monitorWorkflow, new RegExp(action.replace("@", "@")));

const middleware = read("middleware.ts");
assert.match(middleware, /buildContentSecurityPolicy/);
assert.match(middleware, /x-storefront-language/);
assert.match(middleware, /startsWith\("\/admin"\)/);
const rootLayout = read("app/layout.tsx");
assert.match(rootLayout, /<html lang=\{language\}>/);
assert.doesNotMatch(rootLayout, /document\.documentElement\.lang/);

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
assert.equal(
  normalizeLineEndings(read("supabase/client-init.sql")),
  normalizeLineEndings(`${headerLines.join("\n")}\n${snapshotParts.join("\n")}`),
  "client-init.sql drifted from migrations",
);

console.log(`Channel static gates passed for ${migrations.length} ordered migrations.`);
