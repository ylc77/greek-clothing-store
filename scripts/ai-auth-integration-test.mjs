import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3318;
const PROVIDER_PORT = 3418;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PROVIDER_URL = `http://127.0.0.1:${PROVIDER_PORT}/v1/chat/completions`;
const PREFIX = `AUDIT-AI-AUTH-${randomUUID().slice(0, 8).toUpperCase()}-`;
const PII_MARKER = `PII-${randomUUID().slice(0, 8)}`;
const PRIVATE_MARKERS = [
  `${PREFIX}PRIVATE-NAME-CN`,
  `${PREFIX}PRIVATE-SUPPLIER-STYLE`,
  `${PREFIX}PRIVATE-SUPPLIER-SKU`,
];
const PASSWORDS = {
  owner: "AuditAiAuthOwner!2026-Alpha",
  staff: "AuditAiAuthStaff!2026-Bravo",
  inventory: "AuditAiAuthInventory!2026-Charlie",
  readonly: "AuditAiAuthReadonly!2026-Delta",
  developer: `AuditDeveloper!2026-${randomBytes(12).toString("base64url")}`,
};
const AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString("base64url");
const results = [];
const allAppLogs = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    if (options.sensitiveOutput) throw new Error(`${name} failed; sensitive output suppressed.`);
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`);
  }
  return String(result.stdout || "").trim();
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
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`);
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`));
  assert.ok(values.ANON_KEY && values.SERVICE_ROLE_KEY);
  return values;
}

const local = readLocalEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init = {}) => fetch(input, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    }),
  },
});

function redact(value) {
  let output = String(value || "");
  for (const secret of [local.SERVICE_ROLE_KEY, local.ANON_KEY, AUTH_RATE_LIMIT_SECRET, ...Object.values(PASSWORDS)]) {
    if (secret) output = output.replaceAll(secret, "[redacted]");
  }
  return output.slice(-8_000);
}

async function runCase(name, callback) {
  try {
    await callback();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? redact(error.stack) : redact(error));
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerResponse(sku) {
  return JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          reply: "A bounded test response.",
          products: [
            { sku, reason: "Available now" },
            { sku: "INJECTED-NOT-AUTHORIZED", reason: "Prompt injection attempt" },
          ],
          sizeAdvice: "Start with M.",
        }),
      },
    }],
  });
}

async function startProvider() {
  const captures = [];
  let releaseHold = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 256_000) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    captures.push(raw);
    let message = "";
    let allowedSku = "";
    try {
      const envelope = JSON.parse(raw);
      const payload = JSON.parse(envelope.messages?.[1]?.content || "{}");
      message = String(payload.message || "");
      allowedSku = String(payload.ACTUAL_PRODUCTS?.[0]?.sku || "");
    } catch {}

    if (message.includes("TIMEOUT-MARKER")) {
      await delay(2_500);
    }
    if (message.includes("HOLD-MARKER")) {
      await new Promise((resolve) => { releaseHold = resolve; });
    }
    if (message.includes("MALFORMED-MARKER")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{malformed");
      return;
    }
    if (message.includes("OVERSIZE-MARKER")) {
      const body = "x".repeat(70_000);
      response.writeHead(200, { "content-type": "application/json", "content-length": String(body.length) });
      response.end(body);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(providerResponse(allowedSku));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROVIDER_PORT, "127.0.0.1", resolve);
  });
  return {
    server,
    captures,
    release() {
      if (releaseHold) {
        const resolve = releaseHold;
        releaseHold = null;
        resolve();
      }
    },
  };
}

async function stopProvider(provider) {
  if (!provider?.server) return;
  provider.release();
  await new Promise((resolve) => provider.server.close(resolve));
}

async function startApp(options = {}) {
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
      AUTH_RATE_LIMIT_SECRET: options.securityUnavailable ? "" : AUTH_RATE_LIMIT_SECRET,
      IP_PSEUDONYM_SECRET: "",
      AUTH_MAX_FAILURES: "3",
      AUTH_FAILURE_WINDOW_SECONDS: "600",
      AUTH_BLOCK_SECONDS: "600",
      AUTH_FAILURE_SUBJECT_CAPACITY: "50",
      AI_IP_REQUESTS_PER_MINUTE: "2",
      AI_SESSION_REQUESTS_PER_MINUTE: "100",
      AI_STORE_REQUESTS_PER_MINUTE: "100",
      AI_GLOBAL_REQUESTS_PER_MINUTE: "100",
      AI_DAILY_REQUEST_BUDGET: "3",
      AI_GLOBAL_CONCURRENCY: "1",
      AI_PROVIDER_TIMEOUT_MS: "1000",
      AI_TEST_MODE: "true",
      AI_TEST_PROVIDER_URL: PROVIDER_URL,
      DEEPSEEK_API_KEY: "local-test-provider-key",
      USE_POS_RPC: "true",
      USE_PRODUCT_RPC: "true",
      USE_CSV_IMPORT_RPC: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    logs.push(String(chunk));
    allAppLogs.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    logs.push(String(chunk));
    allAppLogs.push(String(chunk));
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev exited early\n${redact(logs.join(""))}`);
    try {
      const response = await fetch(`${APP_URL}/admin`, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) return { child, logs };
    } catch {}
    await delay(400);
  }
  await stopApp({ child });
  throw new Error(`Timed out waiting for Next dev\n${redact(logs.join(""))}`);
}

async function stopApp(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" });
  else server.child.kill("SIGTERM");
  await delay(900);
}

async function jsonRequest(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.role) headers["x-admin-password"] = PASSWORDS[options.role];
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${APP_URL}${pathname}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal || AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}

async function clearSecurityState() {
  for (const [table, column] of [
    ["security_rate_limit_buckets", "subject_hash"],
    ["ai_request_leases", "store_key"],
    ["ai_usage_daily", "store_key"],
    ["security_auth_limits", "subject_hash"],
  ]) {
    const { error } = await service.from(table).delete().neq(column, "__never__");
    if (error) throw error;
  }
}

async function aiRequest(message, options = {}) {
  const headers = {
    "x-vercel-forwarded-for": options.ip || "198.51.100.10",
    "x-forwarded-for": options.forgedForwarded || "203.0.113.250, 10.0.0.1",
    ...(options.cookie ? { cookie: options.cookie } : {}),
  };
  return jsonRequest("/api/ai-shop-assistant", {
    headers,
    body: {
      message,
      language: "en",
      privacyConsent: options.consent !== false,
      measurements: options.measurements,
      productContext: { sku: `${PREFIX}SAFE-1`, supplier_sku: PRIVATE_MARKERS[2] },
    },
  });
}

async function createAuthUser(role, label) {
  const email = `${PREFIX}${label}@example.test`.toLowerCase();
  const password = `AuditAccount!2026-${randomBytes(10).toString("base64url")}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error("test auth user was not created");
  if (role) {
    const { error: rowError } = await service.from("admin_users").insert({
      id: data.user.id,
      email,
      role,
      active: true,
      display_name: `${PREFIX}${label}`,
      created_by: "ai-auth-integration-test",
    });
    if (rowError) throw rowError;
  }
  return { id: data.user.id, email, password };
}

async function signInAccount(account) {
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error || !data.session) throw error || new Error("test account session missing");
  return { client, session: data.session };
}

async function bootstrapDeveloperCredential() {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/developer-credentials.ts",
    "bootstrap",
    "--project-ref", "clothing-web-local",
    "--test-local",
    "--yes",
    "--password-stdin",
    "--no-show-password",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    input: `${PASSWORDS.developer}\n`,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("developer bootstrap failed; output suppressed");
  assert.doesNotMatch(String(result.stdout || ""), new RegExp(PASSWORDS.developer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

let previousFeature = null;
let provider = null;
let app = null;
let developerCookie = "";
const productIds = [];
const authUserIds = [];

async function cleanupFixtures() {
  await service.from("products").delete().like("sku", `${PREFIX}%`);
  await service.from("developer_access").delete().eq("id", 1);
  for (const id of authUserIds.splice(0)) await service.auth.admin.deleteUser(id).catch(() => undefined);
  await clearSecurityState();
}

try {
  await cleanupFixtures();
  const { data: feature, error: featureError } = await service.from("feature_settings")
    .select("plan,features,updated_by").eq("id", 1).single();
  if (featureError) throw featureError;
  previousFeature = feature;
  const { error: featureUpdateError } = await service.from("feature_settings").update({
    plan: "custom",
    features: { ...feature.features, ai_tools: true, staff_accounts: true, pos_checkout: true },
    updated_by: "ai-auth-integration-test",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (featureUpdateError) throw featureUpdateError;

  const { data: products, error: productError } = await service.from("products").insert([
    {
      sku: `${PREFIX}SAFE-1`,
      name_cn: PRIVATE_MARKERS[0],
      name_en: "Audit safe dress",
      name_gr: "Audit safe Greek dress",
      description_en: "Public description",
      category: "women",
      subcategory: "dresses",
      price: 29.9,
      stock: 2,
      sizes: "S,M",
      size_system: "letter",
      size_stock: { S: 1, M: 1 },
      size_chart: { M: { bust: 92 } },
      supplier_style_code: PRIVATE_MARKERS[1],
      is_active: true,
    },
    {
      sku: `${PREFIX}SAFE-2`,
      name_cn: `${PREFIX}INTERNAL-SECOND-NAME`,
      name_en: "Audit safe jacket",
      name_gr: "Audit safe Greek jacket",
      description_en: "Public second description",
      category: "women",
      subcategory: "jackets",
      price: 49.9,
      stock: 1,
      sizes: "ONE SIZE",
      size_system: "one_size",
      size_stock: { "ONE SIZE": 1 },
      size_chart: {},
      supplier_style_code: "",
      is_active: true,
    },
  ]).select("id");
  if (productError) throw productError;
  productIds.push(...products.map((product) => product.id));

  await bootstrapDeveloperCredential();
  provider = await startProvider();
  app = await startApp();

  await runCase("AI requires explicit privacy consent and bounds request size", async () => {
    const withoutConsent = await aiRequest("Please recommend a product", { consent: false });
    assert.equal(withoutConsent.status, 403);
    assert.equal(withoutConsent.data.code, "CONSENT_REQUIRED");
    const oversized = await aiRequest("x".repeat(801));
    assert.equal(oversized.status, 400);
    assert.equal(oversized.data.code, "INVALID_INPUT");
  });

  await runCase("AI sends only bounded public product context and filters injected SKUs", async () => {
    await clearSecurityState();
    provider.captures.length = 0;
    const response = await aiRequest("Recommend an audit dress safely", {
      ip: "198.51.100.20",
      measurements: { height: 170, weight: 63, usualSize: PII_MARKER },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual(response.data.products.map((product) => product.sku), [`${PREFIX}SAFE-1`]);
    assert.equal(provider.captures.length, 1);
    const captured = provider.captures[0];
    assert.match(captured, new RegExp(PII_MARKER));
    for (const marker of PRIVATE_MARKERS) assert.doesNotMatch(captured, new RegExp(marker));
    assert.doesNotMatch(captured, /INJECTED-NOT-AUTHORIZED/);
  });

  await runCase("AI IP rate limit survives forged forwarding values", async () => {
    await clearSecurityState();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await aiRequest(`Rate test ${attempt}`, {
        ip: "198.51.100.30",
        forgedForwarded: `203.0.113.${100 + attempt}, 10.0.0.1`,
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
    }
    const blocked = await aiRequest("Rate test blocked", {
      ip: "198.51.100.30",
      forgedForwarded: "192.0.2.99, 10.0.0.1",
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.code, "AI_RATE_LIMITED");
    assert.equal(blocked.data.retryAfter > 0, true);
  });

  await runCase("AI daily budget and global concurrency fail closed", async () => {
    await clearSecurityState();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await aiRequest(`Budget request ${attempt}`, { ip: `198.51.100.${40 + attempt}` });
      assert.equal(response.status, 200, JSON.stringify(response.data));
    }
    const budget = await aiRequest("Budget request blocked", { ip: "198.51.100.50" });
    assert.equal(budget.status, 429);
    assert.equal(budget.data.code, "AI_DAILY_BUDGET_EXHAUSTED");

    await clearSecurityState();
    const held = aiRequest("HOLD-MARKER concurrency request", { ip: "198.51.100.60" });
    const deadline = Date.now() + 5_000;
    while (provider.captures.every((capture) => !capture.includes("HOLD-MARKER")) && Date.now() < deadline) await delay(25);
    const concurrent = await aiRequest("Concurrent request", { ip: "198.51.100.61" });
    assert.equal(concurrent.status, 429);
    assert.equal(concurrent.data.code, "AI_CONCURRENCY_LIMIT");
    provider.release();
    assert.equal((await held).status, 200);
  });

  await runCase("AI provider timeout, malformed JSON, and oversized output are bounded", async () => {
    for (const [message, status, code] of [
      ["TIMEOUT-MARKER request", 504, "AI_PROVIDER_TIMEOUT"],
      ["MALFORMED-MARKER request", 502, "AI_PROVIDER_INVALID_RESPONSE"],
      ["OVERSIZE-MARKER request", 502, "AI_PROVIDER_INVALID_RESPONSE"],
    ]) {
      await clearSecurityState();
      const response = await aiRequest(message, { ip: `198.51.100.${70 + status % 10}` });
      assert.equal(response.status, status, JSON.stringify(response.data));
      assert.equal(response.data.code, code);
    }
  });

  await runCase("admin password brute-force state persists across a cold Next instance", async () => {
    await clearSecurityState();
    const headers = { "x-admin-password": "wrong-owner-value", "x-vercel-forwarded-for": "198.51.100.80" };
    assert.equal((await jsonRequest("/api/admin/session", { headers })).status, 401);
    assert.equal((await jsonRequest("/api/admin/session", { headers })).status, 401);
    await stopApp(app);
    app = await startApp();
    const blocked = await jsonRequest("/api/admin/session", { headers });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.code, "AUTH_RATE_LIMITED");
    const validOtherIp = await jsonRequest("/api/admin/session", {
      role: "owner",
      headers: { "x-vercel-forwarded-for": "198.51.100.81" },
    });
    assert.equal(validOtherIp.status, 200, JSON.stringify(validOtherIp.data));
  });

  await runCase("developer password brute-force state persists and successful Cookie is hardened", async () => {
    await service.from("security_auth_limits").delete().eq("namespace", "developer-password");
    const headers = { "x-vercel-forwarded-for": "198.51.100.90" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await jsonRequest("/api/admin/developer-session", {
        headers,
        body: { password: "wrong-developer-value" },
      });
      assert.equal(response.status, 401);
    }
    await stopApp(app);
    app = await startApp();
    const blocked = await jsonRequest("/api/admin/developer-session", {
      headers,
      body: { password: "wrong-developer-value" },
    });
    assert.equal(blocked.status, 429);
    const valid = await jsonRequest("/api/admin/developer-session", {
      headers: { "x-vercel-forwarded-for": "198.51.100.91" },
      body: { password: PASSWORDS.developer },
    });
    assert.equal(valid.status, 200, JSON.stringify(valid.data));
    const cookie = valid.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/admin/i);
    assert.doesNotMatch(cookie, new RegExp(PASSWORDS.developer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    developerCookie = cookie.split(";", 1)[0];
  });

  await runCase("401, 403, FEATURE_DISABLED, and 503 semantics are distinct", async () => {
    await clearSecurityState();
    assert.equal((await jsonRequest("/api/admin/pos/checkout", { body: {} })).status, 401);
    const forbidden = await jsonRequest("/api/admin/pos/checkout", {
      role: "readonly",
      headers: { "x-vercel-forwarded-for": "198.51.100.101" },
      body: {},
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.data.code, "FORBIDDEN");

    const { data: feature } = await service.from("feature_settings").select("features").eq("id", 1).single();
    const disableFeature = await jsonRequest("/api/admin/features", {
      method: "PUT",
      headers: { cookie: developerCookie },
      body: {
        plan: "custom",
        features: {
          ...feature.features,
          pos_checkout: false,
          pos_orders: false,
          pos_void: false,
          pos_reports: false,
          receipt_printing: false,
        },
      },
    });
    assert.equal(disableFeature.status, 200, JSON.stringify(disableFeature.data));
    const disabled = await jsonRequest("/api/admin/pos/checkout", {
      role: "owner",
      headers: { "x-vercel-forwarded-for": "198.51.100.102" },
      body: {},
    });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.data.code, "FEATURE_DISABLED");
    const restoreFeature = await jsonRequest("/api/admin/features", {
      method: "PUT",
      headers: { cookie: developerCookie },
      body: { plan: "custom", features: { ...feature.features, pos_checkout: true } },
    });
    assert.equal(restoreFeature.status, 200, JSON.stringify(restoreFeature.data));

    await stopApp(app);
    app = await startApp({ securityUnavailable: true });
    const unavailable = await jsonRequest("/api/admin/session", {
      role: "owner",
      headers: { "x-vercel-forwarded-for": "198.51.100.103" },
    });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.data.code, "AUTH_SECURITY_UNAVAILABLE");
    await stopApp(app);
    app = await startApp();
  });

  await runCase("employee tokens refresh, forbidden accounts stay 403, and local sign-out clears the session", async () => {
    const staff = await createAuthUser("staff", "staff");
    authUserIds.push(staff.id);
    const outsider = await createAuthUser(null, "outsider");
    authUserIds.push(outsider.id);
    const staffAuth = await signInAccount(staff);
    const initial = await jsonRequest("/api/admin/session", {
      headers: { Authorization: `Bearer ${staffAuth.session.access_token}` },
    });
    assert.equal(initial.status, 200, JSON.stringify(initial.data));
    assert.equal(initial.data.role, "staff");
    const { data: refreshed, error: refreshError } = await staffAuth.client.auth.refreshSession();
    if (refreshError || !refreshed.session?.access_token) throw refreshError || new Error("refreshed token missing");
    const afterRefresh = await jsonRequest("/api/admin/session", {
      headers: { Authorization: `Bearer ${refreshed.session.access_token}` },
    });
    assert.equal(afterRefresh.status, 200);

    const outsiderAuth = await signInAccount(outsider);
    const outsiderResponse = await jsonRequest("/api/admin/session", {
      headers: { Authorization: `Bearer ${outsiderAuth.session.access_token}` },
    });
    assert.equal(outsiderResponse.status, 403);
    assert.equal(outsiderResponse.data.code, "FORBIDDEN");

    const { error: signOutError } = await staffAuth.client.auth.signOut({ scope: "local" });
    assert.ifError(signOutError);
    assert.equal((await staffAuth.client.auth.getSession()).data.session, null);
    await outsiderAuth.client.auth.signOut({ scope: "local" });
  });

  await runCase("server logs contain no body measurements, credential material, or service key", async () => {
    const logs = allAppLogs.join("");
    assert.doesNotMatch(logs, new RegExp(PII_MARKER));
    assert.doesNotMatch(logs, new RegExp(local.SERVICE_ROLE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const password of Object.values(PASSWORDS)) {
      assert.doesNotMatch(logs, new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
} finally {
  await stopApp(app);
  await stopProvider(provider);
  if (previousFeature) {
    await service.from("feature_settings").update({
      plan: previousFeature.plan,
      features: previousFeature.features,
      updated_by: previousFeature.updated_by,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  }
  await cleanupFixtures();
  const [{ count: productsLeft }, { count: authLimitsLeft }, { count: aiLeasesLeft }, { count: developerLeft }] = await Promise.all([
    service.from("products").select("id", { count: "exact", head: true }).like("sku", `${PREFIX}%`),
    service.from("security_auth_limits").select("namespace", { count: "exact", head: true }),
    service.from("ai_request_leases").select("request_id", { count: "exact", head: true }),
    service.from("developer_access").select("id", { count: "exact", head: true }).eq("id", 1),
  ]);
  assert.equal(productsLeft, 0, "AI product fixture cleanup failed");
  assert.equal(authLimitsLeft, 0, "authentication limiter cleanup failed");
  assert.equal(aiLeasesLeft, 0, "AI lease cleanup failed");
  assert.equal(developerLeft, 0, "developer credential cleanup failed");
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`${failures.length} AI/auth integration case(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`${results.length} AI/auth integration cases passed; fixtures and secrets were cleaned.`);
}
