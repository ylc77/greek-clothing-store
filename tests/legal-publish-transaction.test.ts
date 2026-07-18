import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260718064715_transactional_legal_settings_publish.sql",
);
const routePath = path.join(root, "app", "api", "admin", "legal-settings", "route.ts");

test("legal publishing is one security-definer database transaction", () => {
  const sql = fs.readFileSync(migrationPath, "utf8").toLowerCase();
  assert.match(sql, /create or replace function public\.legal_settings_publish_rpc\(/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /update public\.legal_settings_versions[\s\S]*is_current = false/);
  assert.match(sql, /insert into public\.legal_settings_versions[\s\S]*true/);
  assert.match(sql, /insert into public\.legal_settings[\s\S]*on conflict \(id\) do update/);
  assert.match(sql, /revoke all on function public\.legal_settings_publish_rpc\(jsonb, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.legal_settings_publish_rpc\(jsonb, text\) to service_role/);
});

test("legal publish route fails closed instead of performing Node.js multi-step writes", () => {
  const route = fs.readFileSync(routePath, "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(post, /\.rpc\(\s*"legal_settings_publish_rpc"/);
  assert.match(post, /status: 503/);
  assert.match(post, /LEGAL_PUBLISH_UNAVAILABLE/);
  assert.doesNotMatch(post, /\.from\("legal_settings_versions"\)/);
  assert.doesNotMatch(post, /版本已创建，但/);
});
