import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3315;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const DB_CONTAINER = "supabase_db_clothing_web";
const PREFIX = "AUDIT-CSV-ROUTE-";
const PASSWORDS = {
  owner: "AuditCsvOwner!2026-Alpha",
  staff: "AuditCsvStaff!2026-Bravo",
  inventory: "AuditCsvInventory!2026-Charlie",
  readonly: "AuditCsvReadonly!2026-Delta",
};
const AUTH_RATE_LIMIT_SECRET = "test-only-csv-auth-rate-limit-secret-2026";
const results = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) {
    if (options.sensitiveOutput) throw new Error(`${name} failed; sensitive output was intentionally suppressed.`);
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || ""}`);
  }
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", [
    "exec", "-i", DB_CONTAINER,
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: statement });
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readLocalEnvironment() {
  const output = process.platform === "win32"
    ? command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"], { sensitiveOutput: true })
    : command("npx", ["supabase", "status", "-o", "env"], { sensitiveOutput: true });
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`, "route tests must use clothing_web local API");
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`));
  assert.ok(values.ANON_KEY);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

function redactLogs(value, local) {
  let redacted = String(value || "");
  for (const secret of [local.SERVICE_ROLE_KEY, local.ANON_KEY]) {
    if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted.slice(-4000);
}

async function startApp(local, csvRpcEnabled) {
  fs.rmSync(path.join(ROOT, ".next", "cache"), { recursive: true, force: true });
  const logs = [];
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      ADMIN_PASSWORD: PASSWORDS.owner,
      ADMIN_STAFF_PASSWORD: PASSWORDS.staff,
      ADMIN_INVENTORY_PASSWORD: PASSWORDS.inventory,
      ADMIN_READONLY_PASSWORD: PASSWORDS.readonly,
      AUTH_RATE_LIMIT_SECRET,
      USE_POS_RPC: "true",
      USE_PRODUCT_RPC: "true",
      USE_CSV_IMPORT_RPC: csvRpcEnabled ? "true" : "false",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev exited early\n${redactLogs(logs.join(""), local)}`);
    try {
      const response = await fetch(`${APP_URL}/admin`, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) return { child, logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopApp({ child });
  throw new Error(`Timed out waiting for Next dev\n${redactLogs(logs.join(""), local)}`);
}

async function stopApp(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" });
  else server.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 750));
}

function csvForm(productSku, operationId = "") {
  const body = new FormData();
  const csv = `sku,name_cn,name_en,name_gr,category,subcategory,price\n${productSku},测试商品,Test product,Δοκιμαστικό προϊόν,women,dresses,19.90\n`;
  body.append("file", new Blob([csv], { type: "text/csv;charset=utf-8" }), `${PREFIX.toLowerCase()}fixture.csv`);
  body.append("importMode", "create_only");
  body.append("inventoryMode", "metadata_only");
  if (operationId) body.append("operationId", operationId);
  return body;
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.role) headers["x-admin-password"] = PASSWORDS[options.role];
  let body = options.body;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`${APP_URL}${pathname}`, {
    method: options.method || (body === undefined ? "GET" : "POST"),
    headers,
    body,
    signal: options.signal || AbortSignal.timeout(30_000),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();
  return { status: response.status, data, headers: response.headers };
}

async function runCase(name, callback) {
  try {
    await callback();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

function fixtureCounts() {
  return {
    jobs: Number(sql(`select count(*) from public.product_import_jobs where client_request_id like ${quote(`${PREFIX}%`)};`)),
    products: Number(sql(`select count(*) from public.products where sku like ${quote(`${PREFIX}%`)};`)),
  };
}

function cleanup() {
  sql(`
    delete from public.product_import_jobs where client_request_id like ${quote(`${PREFIX}%`)};
    delete from public.product_operations where client_request_id like ${quote(`${PREFIX}%`)}
      or product_id in (select id from public.products where sku like ${quote(`${PREFIX}%`)});
    delete from public.inventory_operations where operation_key like ${quote(`%${PREFIX}%`)};
    delete from public.stock_movements where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.products where sku like ${quote(`${PREFIX}%`)};
  `);
}

function featuresWith(base, values) {
  return { ...(base || {}), ...values };
}

async function setFeatures(supabase, previous, values, label) {
  const { error } = await supabase.from("feature_settings")
    .update({
      plan: "custom",
      features: featuresWith(previous.features, values),
      updated_by: label,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw error;
}

const local = readLocalEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let previousFeature;
let server;
let createdJobId = "";

try {
  cleanup();
  const { data, error } = await service.from("feature_settings").select("plan, features, updated_by").eq("id", 1).single();
  if (error) throw error;
  previousFeature = data;
  await setFeatures(service, previousFeature, {
    csv_import: true,
    backup_tools: true,
    ai_tools: true,
    staff_accounts: true,
  }, "csv-route-enabled");
  server = await startApp(local, true);

  await runCase("CSV preview and start enforce 401/403 before any Job write", async () => {
    const before = fixtureCounts();
    for (const role of [undefined, "staff", "inventory", "readonly"]) {
      const expected = role ? 403 : 401;
      const productSku = `${PREFIX}DENIED-${role || "ANON"}-${randomUUID()}`;
      const preview = await request("/api/admin/products/import/preview", { role, body: csvForm(productSku) });
      assert.equal(preview.status, expected, JSON.stringify(preview.data));
      const start = await request("/api/admin/products/import", {
        role,
        body: csvForm(productSku, `${PREFIX}DENIED-${randomUUID()}`),
      });
      assert.equal(start.status, expected, JSON.stringify(start.data));
    }
    assert.deepEqual(fixtureCounts(), before);
  });

  await runCase("owner can preview, create, replay, and recover one CSV Job", async () => {
    const productSku = `${PREFIX}OWNER-${randomUUID()}`;
    const operationId = `${PREFIX}OP-${randomUUID()}`;
    const preview = await request("/api/admin/products/import/preview", { role: "owner", body: csvForm(productSku) });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const start = await request("/api/admin/products/import", { role: "owner", body: csvForm(productSku, operationId) });
    assert.ok([200, 202].includes(start.status), JSON.stringify(start.data));
    createdJobId = String(start.data?.job?.id || "");
    assert.match(createdJobId, /^[0-9a-f-]{36}$/i);
    const replay = await request("/api/admin/products/import", { role: "owner", body: csvForm(productSku, operationId) });
    assert.ok([200, 202].includes(replay.status), JSON.stringify(replay.data));
    assert.equal(replay.data?.job?.id, createdJobId);
    assert.equal(replay.data?.replayed, true);
    const recovered = await request(`/api/admin/products/import?operationId=${encodeURIComponent(operationId)}`, { role: "owner" });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
    assert.equal(recovered.data?.job?.id, createdJobId);
    assert.deepEqual(fixtureCounts(), { jobs: 1, products: 1 });
  });

  await runCase("Job detail, process, retry, and failed-row CSV enforce the role matrix", async () => {
    const endpoints = [
      { path: `/api/admin/products/import/jobs/${createdJobId}`, method: "GET" },
      { path: `/api/admin/products/import/jobs/${createdJobId}/process`, method: "POST" },
      { path: `/api/admin/products/import/jobs/${createdJobId}/retry`, method: "POST" },
      { path: `/api/admin/products/import/jobs/${createdJobId}/errors.csv`, method: "GET" },
    ];
    for (const endpoint of endpoints) {
      for (const role of [undefined, "staff", "inventory", "readonly"]) {
        const response = await request(endpoint.path, { role, method: endpoint.method });
        assert.equal(response.status, role ? 403 : 401, `${endpoint.path} ${role}: ${JSON.stringify(response.data)}`);
      }
      const owner = await request(endpoint.path, { role: "owner", method: endpoint.method });
      assert.equal(owner.status, 200, `${endpoint.path}: ${JSON.stringify(owner.data)}`);
    }
  });

  await runCase("translation and product export enforce products:write and backup:read", async () => {
    const translationBody = { rows: [{ rowNumber: 1, name_cn: "测试", description_cn: "", name_en: "", description_en: "", name_gr: "", description_gr: "" }] };
    for (const role of [undefined, "staff", "inventory", "readonly"]) {
      const translation = await request("/api/admin/products/import/translate", { role, json: translationBody });
      assert.equal(translation.status, role ? 403 : 401, JSON.stringify(translation.data));
      const backup = await request("/api/admin/backup", { role });
      assert.equal(backup.status, role ? 403 : 401, JSON.stringify(backup.data));
    }
    const translation = await request("/api/admin/products/import/translate", { role: "owner", json: translationBody });
    assert.equal(translation.status, 200, JSON.stringify(translation.data));
    const backup = await request("/api/admin/backup", { role: "owner" });
    assert.equal(backup.status, 200, JSON.stringify(backup.data));
    assert.equal(backup.headers.get("cache-control"), "no-store");
  });

  await stopApp(server);
  server = await startApp(local, false);
  await runCase("missing CSV RPC configuration returns 503 without a write", async () => {
    const before = fixtureCounts();
    const productSku = `${PREFIX}CONFIG-${randomUUID()}`;
    const start = await request("/api/admin/products/import", {
      role: "owner",
      body: csvForm(productSku, `${PREFIX}CONFIG-OP-${randomUUID()}`),
    });
    assert.equal(start.status, 503, JSON.stringify(start.data));
    assert.equal(start.data?.code, "CSV_IMPORT_RPC_REQUIRED");
    const processResult = await request(`/api/admin/products/import/jobs/${createdJobId}/process`, { role: "owner", method: "POST" });
    assert.equal(processResult.status, 503, JSON.stringify(processResult.data));
    assert.deepEqual(fixtureCounts(), before);
  });

  await stopApp(server);
  await setFeatures(service, previousFeature, {
    csv_import: false,
    backup_tools: false,
    ai_tools: true,
    staff_accounts: true,
  }, "csv-route-disabled");
  server = await startApp(local, true);
  await runCase("disabled CSV and backup Features reject every Route before a write", async () => {
    const before = fixtureCounts();
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const productSku = `${PREFIX}FEATURE-${randomUUID()}`;
    const responses = [
      await request("/api/admin/products/import/preview", { role: "owner", body: csvForm(productSku) }),
      await request("/api/admin/products/import", { role: "owner", body: csvForm(productSku, `${PREFIX}FEATURE-OP`) }),
      await request(`/api/admin/products/import?operationId=${encodeURIComponent(`${PREFIX}FEATURE-OP`)}`, { role: "owner" }),
      await request("/api/admin/products/import/translate", { role: "owner", json: { rows: [] } }),
      await request(`/api/admin/products/import/jobs/${fakeId}`, { role: "owner" }),
      await request(`/api/admin/products/import/jobs/${fakeId}/process`, { role: "owner", method: "POST" }),
      await request(`/api/admin/products/import/jobs/${fakeId}/retry`, { role: "owner", method: "POST" }),
      await request(`/api/admin/products/import/jobs/${fakeId}/errors.csv`, { role: "owner" }),
      await request("/api/admin/backup", { role: "owner" }),
    ];
    for (const response of responses) {
      assert.equal(response.status, 403, JSON.stringify(response.data));
      assert.equal(response.data?.code, "FEATURE_DISABLED", JSON.stringify(response.data));
    }
    assert.deepEqual(fixtureCounts(), before);
  });
} finally {
  await stopApp(server);
  if (previousFeature) {
    const { error } = await service.from("feature_settings")
      .update({ ...previousFeature, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) console.error("Failed to restore Feature settings after CSV Route tests.");
  }
  try { cleanup(); } catch {}
  fs.rmSync(path.join(ROOT, ".next", "cache"), { recursive: true, force: true });
}

await runCase("CSV Route integration test data is fully cleaned", async () => {
  assert.deepEqual(fixtureCounts(), { jobs: 0, products: 0 });
});

const failures = results.filter((result) => !result.ok);
console.log(`\nCSV Route integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) process.exit(1);
