import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8", input: options.input, stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${name} failed\n${result.stderr || result.stdout || ""}`);
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-q", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement });
}

function readLocalEnvironment() {
  const output = process.platform === "win32"
    ? command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"])
    : command("npx", ["supabase", "status", "-o", "env"]);
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const functions = [
  "public.pos_day_bounds_rpc(date)",
  "public.pos_orders_page_rpc(text,text,text,text,integer,integer)",
  "public.pos_reconciliation_rpc(timestamp with time zone,timestamp with time zone,uuid,integer,integer)",
  "public.pos_daily_report_rpc(date,integer,integer)",
  "public.pos_search_rpc(text,integer)",
  "public.variant_barcodes_apply_rpc(text,jsonb,text,text)",
  "public.variant_barcodes_generate_missing_rpc(text,jsonb,text)",
  "public.inventory_receipt_complete_rpc(text,uuid,text,text,jsonb,text)",
  "public.inventory_receipt_runtime_health_rpc()",
  "public.operations_runtime_health_rpc()",
];

for (const signature of functions) {
  assert.notEqual(sql(`select pg_catalog.to_regprocedure('${signature}') is not null;`), "f", `missing ${signature}`);
  for (const role of ["public", "anon", "authenticated"]) {
    assert.equal(sql(`select pg_catalog.has_function_privilege('${role}','${signature}','execute');`), "f", `${role} can execute ${signature}`);
  }
  assert.equal(sql(`select pg_catalog.has_function_privilege('service_role','${signature}','execute');`), "t", `service_role cannot execute ${signature}`);
  assert.match(sql(`select pg_catalog.array_to_string(proconfig, ',') from pg_catalog.pg_proc where oid='${signature}'::pg_catalog.regprocedure;`), /search_path=/);
  assert.equal(sql(`select prosecdef from pg_catalog.pg_proc where oid='${signature}'::pg_catalog.regprocedure;`), "t");
}

assert.equal(sql("select relrowsecurity from pg_catalog.pg_class where oid='public.barcode_operations'::pg_catalog.regclass;"), "t");
assert.equal(sql("select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='barcode_operations';"), "0");
for (const role of ["anon", "authenticated"]) {
  for (const privilege of ["select", "insert", "update", "delete"]) {
    assert.equal(sql(`select pg_catalog.has_table_privilege('${role}','public.barcode_operations','${privilege}');`), "f");
  }
  assert.equal(sql(`select pg_catalog.has_table_privilege('${role}','public.audit_logs','select');`), "f");
}
assert.equal(sql("select pg_catalog.has_table_privilege('service_role','public.barcode_operations','select,insert');"), "t");
assert.equal(sql("select pg_catalog.has_table_privilege('service_role','public.barcode_operations','update,delete');"), "f");
assert.equal(sql("select pg_catalog.has_table_privilege('service_role','public.audit_logs','select');"), "t");
assert.equal(sql("select pg_catalog.has_table_privilege('service_role','public.audit_logs','insert,update,delete');"), "f");
assert.equal(sql("select prosecdef from pg_catalog.pg_proc where oid='app_private.audit_logs_immutable_trigger()'::pg_catalog.regprocedure;"), "f", "immutability trigger must observe the caller role");
for (const table of ["inventory_receipts", "inventory_receipt_items"]) {
  assert.equal(sql(`select relrowsecurity from pg_catalog.pg_class where oid='public.${table}'::pg_catalog.regclass;`), "t");
  assert.equal(sql(`select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='${table}';`), "0");
  for (const role of ["anon", "authenticated"]) {
    assert.equal(sql(`select pg_catalog.has_table_privilege('${role}','public.${table}','select,insert,update,delete');`), "f");
  }
  assert.equal(sql(`select pg_catalog.has_table_privilege('service_role','public.${table}','select,insert,update,delete');`), "t");
}
assert.equal(sql("select count(*) from information_schema.role_table_grants where table_schema='app_private' and table_name='pos_order_reconciliation' and grantee in ('anon','authenticated','public');"), "0");

const local = readLocalEnvironment();
assert.ok(local.API_URL && local.ANON_KEY && local.SERVICE_ROLE_KEY);
const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anonResult = await anon.rpc("operations_runtime_health_rpc");
assert.ok(anonResult.error);
assert.equal(anonResult.error.code, "42501");
const serviceResult = await service.rpc("operations_runtime_health_rpc");
if (serviceResult.error) throw serviceResult.error;
assert.equal(serviceResult.data.ready, true);

console.log("Operations database security gates passed.");
