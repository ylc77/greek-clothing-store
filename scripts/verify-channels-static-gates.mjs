import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
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
]) assert.match(legalMigration.toLowerCase(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const legalRoute = read("app/api/admin/legal-settings/route.ts");
const legalPost = legalRoute.slice(legalRoute.indexOf("export async function POST"));
assert.match(legalPost, /\.rpc\(\s*"legal_settings_publish_rpc"/);
assert.match(legalPost, /LEGAL_PUBLISH_UNAVAILABLE/);
assert.doesNotMatch(legalPost, /\.from\("legal_settings_versions"\)/);

const feed = read("lib/skroutz-feed.ts");
for (const marker of [
  "MAIN_STORE",
  "quantity_reserved",
  "image_width",
  "image_height",
  "validEan",
  "isTestSku",
  "name_en",
  "description_en",
]) assert.match(feed, new RegExp(marker));
assert.doesNotMatch(feed, /product\.brand\s*\|\|\s*fallbackBrand/, "store name must never be substituted for a real manufacturer");
assert.match(feed, /hasUnmappedSizedStock/, "sized stock without a complete variation must fail closed");

const readiness = read("lib/skroutz-readiness.ts");
for (const marker of ["name_en", "description_en", "image_width", "image_height", "manufacturer", "https:"]) {
  assert.match(readiness, new RegExp(marker));
}
assert.match(readiness, /\^\(\?:\\d\{8\}\|\\d\{13\}\)\$/);
const adminDashboard = read("components/admin-dashboard.tsx");
assert.match(adminDashboard, /进入 Skroutz 必填/);
assert.match(adminDashboard, /至少一边 > 1000px/);
assert.doesNotMatch(adminDashboard, /EAN（Skroutz 选填）|MPN（Skroutz 选填）/);

const monitor = read("scripts/site-smoke-check.js");
for (const marker of ["XMLParser", "SkroutzBot v1.0", "Skroutz ImageBot v1", "additionalImages", "variationQuantity", "STRICT_FEED"]) {
  assert.match(monitor, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
const monitorWorkflow = read(".github/workflows/site-monitor.yml");
assert.match(monitorWorkflow, /STRICT_FEED:\s*"true"/);
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
assert.equal(read("supabase/client-init.sql"), `${headerLines.join("\n")}\n${snapshotParts.join("\n")}`, "client-init.sql drifted from migrations");

console.log(`Channel static gates passed for ${migrations.length} ordered migrations.`);
