import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const migrations = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const securityMigrations = migrations.filter((name) => /^\d+_ai_auth_abuse_protection\.sql$/.test(name));
assert.equal(securityMigrations.length, 1, "expected exactly one AI/auth abuse protection migration");
const migrationName = securityMigrations[0];
assert.ok(BigInt(migrationName.split("_", 1)[0]) > 20260716141423n, "AI/auth migration must sort after storage hardening");

const migration = read(`supabase/migrations/${migrationName}`);
for (const table of ["security_rate_limit_buckets", "ai_usage_daily", "ai_request_leases", "security_auth_limits"]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
}
for (const fn of ["ai_rate_limit_begin_rpc", "ai_rate_limit_finish_rpc", "auth_rate_limit_status_rpc", "auth_rate_limit_record_rpc"]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${fn}`, "i"));
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, "i"));
}
assert.match(migration, /security definer\s+set search_path = ''/i);
assert.match(migration, /p_capacity integer/i);
assert.match(migration, /admin_users_email_ci_unique_idx/i);
assert.match(migration, /ADMIN_USER_EMAIL_CONFLICT/i);

const aiRoute = read("app/api/ai-shop-assistant/route.ts");
for (const marker of [
  "AI_PRODUCT_SELECT",
  "createBoundedAiCustomerPayload",
  "beginSharedAiRequest",
  "finishSharedAiRequest",
  "AbortController",
  "readLimitedResponseText",
  "max_tokens: 500",
  "parseAndConstrainAiModelOutput",
]) assert.match(aiRoute, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(aiRoute, /new\s+Map\s*</, "public AI limits must not use a process-local Map");
assert.doesNotMatch(aiRoute, /cost_price|supplier_sku|supplier_id/, "public AI route must not reference procurement fields");

const aiSecurity = read("lib/ai-security.ts");
for (const marker of ["16_384", "message.length > 800", "privacyConsent", "60_000", "allowedSkus", "UPSTREAM_RESPONSE_TOO_LARGE"]) {
  assert.match(aiSecurity, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const chat = read("components/chat-assistant.tsx");
assert.match(chat, /privacyConsent/);
assert.match(chat, /type="checkbox"/);

const developerRoute = read("app/api/admin/developer-session/route.ts");
assert.match(developerRoute, /checkSharedAuthLimit/);
assert.match(developerRoute, /recordSharedAuthAttempt/);
assert.doesNotMatch(developerRoute, /new\s+Map\s*</);

const passwordSecurity = read("lib/admin-password-security.ts");
assert.match(passwordSecurity, /timingSafeEqual/);
assert.match(passwordSecurity, /value\.length < 16/);
assert.ok(passwordSecurity.includes("|| !/[a-z]/i.test(value)"));
assert.ok(passwordSecurity.includes("|| !/\\d/.test(value)"));
assert.ok(!passwordSecurity.includes("|| !/[^a-z0-9]/i.test(value)"));
assert.match(passwordSecurity, /DUPLICATE_PASSWORD/);
const instrumentation = read("instrumentation.ts");
assert.match(instrumentation, /validateAdminPasswordEnvironment\(process\.env\)/);

const dashboard = read("components/admin-dashboard.tsx");
for (const marker of ["onAuthStateChange", "TOKEN_REFRESHED", "getSession", "signOut({ scope: \"local\" })"]) {
  assert.match(dashboard + read("lib/admin-session-lifecycle.ts"), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const adminSources = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (entry.name.endsWith(".ts")) adminSources.push(absolute);
  }
}
collect(path.join(root, "app", "api", "admin"));
for (const absolute of adminSources) {
  const source = fs.readFileSync(absolute, "utf8");
  assert.doesNotMatch(source, /getAdminAuthContextFromRequest/, `${path.relative(root, absolute)} bypasses normalized authorization decisions`);
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

const workflow = read(".github/workflows/p1-remediation-gate.yml");
for (const command of [
  "npm run test:ai-auth-unit",
  "npm run check:ai-auth-static",
  "npm run check:ai-auth-db-security",
  "npm run test:ai-auth-integration",
  "npm run test:ai-auth-install-paths",
]) assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `CI is missing ${command}`);

console.log(`AI/auth static gates passed for ${migrationName}.`);
