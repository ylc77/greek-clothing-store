import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3314;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PASSWORDS = { owner: "feature-gate-owner", staff: "feature-gate-staff" };
const results = [];

function command(name, args) {
  const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || ""}`);
  return String(result.stdout || "").trim();
}

function readLocalEnvironment() {
  const output = process.platform === "win32"
    ? command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"])
    : command("supabase", ["status", "-o", "env"]);
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`, "feature tests must use clothing_web local API");
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`));
  assert.ok(values.ANON_KEY);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

async function startApp(local) {
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
      USE_POS_RPC: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev exited early\n${logs.join("")}`);
    try {
      const response = await fetch(`${APP_URL}/admin`);
      if (response.status < 500) return { child, logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopApp({ child, logs });
  throw new Error(`Timed out waiting for Next dev\n${logs.join("")}`);
}

async function stopApp(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" });
  else server.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.role) headers["x-admin-password"] = PASSWORDS[options.role];
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${APP_URL}${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function countRows(supabase) {
  const tables = ["sales_orders", "sales_order_items", "payments", "inventory_operations", "stock_movements"];
  const result = {};
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) throw error;
    result[table] = count || 0;
  }
  return result;
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

const local = readLocalEnvironment();
const supabase = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let server;
let previousFeature;
try {
  const { data, error } = await supabase.from("feature_settings").select("plan, features, updated_by").eq("id", 1).single();
  if (error) throw error;
  previousFeature = data;
  const disabled = {
    ...data.features,
    quick_sell: false,
    pos_checkout: false,
    pos_orders: false,
    pos_void: false,
    pos_reports: false,
    receipt_printing: false,
    staff_accounts: false,
    skroutz_feed: false,
    ai_tools: false,
  };
  const { error: updateError } = await supabase.from("feature_settings")
    .update({ plan: "custom", features: disabled, updated_by: "feature-gate-integration-test", updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (updateError) throw updateError;

  const before = await countRows(supabase);
  server = await startApp(local);

  await runCase("disabled POS checkout, search, orders and void APIs fail closed", async () => {
    const responses = await Promise.all([
      request("/api/admin/pos/checkout", { role: "owner", body: {} }),
      request("/api/admin/pos/search?q=feature-gate", { role: "owner" }),
      request("/api/admin/pos/orders", { role: "owner" }),
      request("/api/admin/pos/orders/00000000-0000-4000-8000-000000000000/void", { role: "owner", body: {} }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 403);
      assert.equal(response.data.code, "FEATURE_DISABLED");
    }
  });

  await runCase("disabled Quick Sell API fails before any inventory write", async () => {
    const response = await request("/api/admin/products/sell", { role: "owner", body: {} });
    assert.equal(response.status, 403);
    assert.equal(response.data.code, "FEATURE_DISABLED");
  });

  await runCase("disabled AI and Skroutz public and admin endpoints stay closed", async () => {
    const responses = await Promise.all([
      request("/api/admin/generate-ai-meta", { role: "owner", body: {} }),
      request("/api/ai-shop-assistant", { body: { message: "test" } }),
      request("/feed.xml"),
    ]);
    assert.equal(responses[0].status, 403);
    assert.equal(responses[0].data.code, "FEATURE_DISABLED");
    assert.equal(responses[1].status, 404);
    assert.equal(responses[2].status, 404);
  });

  await runCase("disabled staff accounts reject staff while owner remains authorized", async () => {
    assert.equal((await request("/api/admin/session", { role: "staff" })).status, 401);
    const owner = await request("/api/admin/session", { role: "owner" });
    assert.equal(owner.status, 200);
    assert.equal(owner.data.role, "owner");
  });

  await runCase("feature-gate requests leave every protected business table unchanged", async () => {
    assert.deepEqual(await countRows(supabase), before);
  });
} finally {
  await stopApp(server);
  if (previousFeature) {
    const { error } = await supabase.from("feature_settings")
      .update({ ...previousFeature, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) console.error("Failed to restore feature settings after feature gate tests.");
  }
}

const failures = results.filter((result) => !result.ok);
console.log(`\nFeature Gate integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) process.exit(1);
