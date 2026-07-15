import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3313;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CLI_PATH = "scripts/developer-credentials.ts";
const results = [];
const capturedOutputs = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(`${name} command failed with exit ${result.status}`);
  }
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", [
    "exec", "-i", DB_CONTAINER,
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: statement });
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
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`);
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`));
  assert.ok(values.ANON_KEY);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

const local = readLocalEnvironment();
const supabase = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicClient = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rolePasswords = {
  owner: randomBytes(24).toString("base64url"),
  staff: randomBytes(24).toString("base64url"),
  inventory: randomBytes(24).toString("base64url"),
  readonly: randomBytes(24).toString("base64url"),
};

function strongPassword() {
  return `${randomBytes(24).toString("base64url")}!Aa9`;
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

function runCredentialCli(action, projectRef, options = {}) {
  const args = [
    "--experimental-strip-types",
    CLI_PATH,
    action,
    "--project-ref", projectRef,
    "--yes",
    "--test-local",
  ];
  if (options.password !== undefined) args.push("--password-stdin", "--no-show-password");
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    input: options.password === undefined ? undefined : `${options.password}\n`,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    },
    stdio: options.password === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  capturedOutputs.push(stdout, stderr);
  if (options.expectFailure) {
    assert.notEqual(result.status, 0, `${action} unexpectedly succeeded`);
  } else {
    assert.equal(result.status, 0, `${action} failed`);
  }
  return { stdout, stderr, status: result.status };
}

async function developerRow() {
  const { data, error } = await supabase.from("developer_access")
    .select("password_hash, password_version, credential_version, initialized_at, rotated_at, must_rotate, updated_at")
    .eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

async function appRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(`${APP_URL}${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}

async function login(password) {
  return appRequest("/api/admin/developer-session", { method: "POST", body: { password } });
}

async function createOwnerAccount() {
  const email = `developer-owner-${randomUUID()}@example.test`;
  const password = strongPassword();
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error("owner account creation failed");
  const { error: rowError } = await supabase.from("admin_users").insert({
    id: data.user.id,
    email,
    role: "owner",
    active: true,
    created_by: "developer-credential-integration-test",
  });
  if (rowError) throw rowError;
  const { data: session, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
  if (signInError || !session.session?.access_token) throw signInError || new Error("owner token missing");
  return { id: data.user.id, token: session.session.access_token };
}

async function startApp() {
  const logs = [];
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      ADMIN_PASSWORD: rolePasswords.owner,
      ADMIN_STAFF_PASSWORD: rolePasswords.staff,
      ADMIN_INVENTORY_PASSWORD: rolePasswords.inventory,
      ADMIN_READONLY_PASSWORD: rolePasswords.readonly,
      USE_POS_RPC: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Next dev exited before developer credential tests started");
    try {
      const response = await fetch(`${APP_URL}/admin/settings`);
      if (response.status < 500) return { child, logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopApp({ child, logs });
  throw new Error("Timed out waiting for Next dev");
}

async function stopApp(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" });
  else server.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
}

function installCredentialFault(stage) {
  sql(`
    drop schema if exists audit_developer_credential cascade;
    create schema audit_developer_credential;
    create function audit_developer_credential.fail_write() returns trigger
    language plpgsql as $$
    begin
      if '${stage}' = 'insert' and tg_op = 'INSERT' then raise exception 'AUDIT_DEVELOPER_INSERT_FAILURE'; end if;
      if '${stage}' = 'update' and tg_op = 'UPDATE' then raise exception 'AUDIT_DEVELOPER_UPDATE_FAILURE'; end if;
      return new;
    end;
    $$;
    create trigger audit_developer_credential_failure
      before insert or update on public.developer_access
      for each row execute function audit_developer_credential.fail_write();
  `);
}

function uninstallCredentialFault() {
  sql(`
    drop trigger if exists audit_developer_credential_failure on public.developer_access;
    drop schema if exists audit_developer_credential cascade;
  `);
}

async function deleteCredential() {
  const { error } = await supabase.from("developer_access").delete().eq("id", 1);
  if (error) throw error;
}

async function assertProtectedWritesDenied(headers = {}) {
  const cases = [
    ["/api/admin/settings", "PUT", { business_name: "denied" }],
    ["/api/admin/legal-settings", "PUT", { settings: {} }],
    ["/api/admin/features", "PUT", { plan: "basic" }],
  ];
  for (const [path, method, body] of cases) {
    const response = await appRequest(path, { method, body, headers });
    assert.equal(response.status, 401, `${path} was not fail closed`);
  }
}

let server;
let ownerAccount;
const passwordA = strongPassword();
const passwordB = strongPassword();
const passwordC = strongPassword();
const recoveryPassword = strongPassword();
try {
  uninstallCredentialFault();
  await deleteCredential();
  ownerAccount = await createOwnerAccount();
  server = await startApp();

  await runCase("clean database is uninitialized and all developer writes fail closed", async () => {
    assert.equal(await developerRow(), null);
    const status = await appRequest("/api/admin/developer-session");
    assert.equal(status.status, 200);
    assert.deepEqual(status.data, { initialized: false, mustRotate: false, sessionValid: false });
    const loginResult = await login(passwordA);
    assert.equal(loginResult.status, 503);
    assert.equal(loginResult.data.code, "DEVELOPER_CREDENTIAL_UNINITIALIZED");
    await assertProtectedWritesDenied();
  });

  await runCase("normal owner identities cannot bootstrap rotate or gain developer authorization", async () => {
    await assertProtectedWritesDenied({ "x-admin-password": rolePasswords.owner });
    await assertProtectedWritesDenied({ authorization: `Bearer ${ownerAccount.token}` });
    for (const role of ["staff", "inventory", "readonly"]) {
      await assertProtectedWritesDenied({ "x-admin-password": rolePasswords[role] });
    }
    assert.equal((await appRequest("/api/admin/developer-credentials/bootstrap", { method: "POST", body: {} })).status, 404);
    assert.equal((await appRequest("/api/admin/developer-credentials/rotate", { method: "POST", body: {} })).status, 404);
  });

  await runCase("anon cannot execute trusted credential RPCs", async () => {
    const { error: bootstrapError } = await publicClient.rpc("developer_credential_bootstrap_rpc", {
      p_password_hash: "invalid",
      p_credential_version: randomUUID(),
    });
    const { error: rotateError } = await publicClient.rpc("developer_credential_rotate_rpc", {
      p_password_hash: "invalid",
      p_credential_version: randomUUID(),
      p_expected_credential_version: randomUUID(),
    });
    assert.ok(bootstrapError);
    assert.ok(rotateError);
  });

  await runCase("bootstrap transaction failure leaves no partial credential", async () => {
    installCredentialFault("insert");
    try {
      runCredentialCli("bootstrap", "client-failure-test", { password: strongPassword(), expectFailure: true });
    } finally {
      uninstallCredentialFault();
    }
    assert.equal(await developerRow(), null);
  });

  let hashA;
  let credentialVersionA;
  await runCase("client A bootstrap is unique and refuses a second bootstrap", async () => {
    runCredentialCli("bootstrap", "client-a-test", { password: passwordA });
    const row = await developerRow();
    assert.ok(row);
    assert.equal(row.must_rotate, false);
    hashA = row.password_hash;
    credentialVersionA = row.credential_version;
    assert.equal((await login(passwordA)).status, 200);
    assert.equal((await login(passwordB)).status, 401);
    runCredentialCli("bootstrap", "client-a-test", { password: strongPassword(), expectFailure: true });
  });

  let hashB;
  let credentialVersionB;
  let cookieB1;
  let cookieB2;
  let versionB;
  await runCase("client B receives an isolated salt hash credential version and password", async () => {
    await deleteCredential();
    runCredentialCli("bootstrap", "client-b-test", { password: passwordB });
    const row = await developerRow();
    assert.ok(row);
    hashB = row.password_hash;
    credentialVersionB = row.credential_version;
    versionB = row.password_version;
    assert.notEqual(passwordA, passwordB);
    assert.notEqual(hashA, hashB);
    assert.notEqual(credentialVersionA, credentialVersionB);
    assert.equal((await login(passwordA)).status, 401);
    const first = await login(passwordB);
    const second = await login(passwordB);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    cookieB1 = first.cookie;
    cookieB2 = second.cookie;
    assert.ok(cookieB1 && cookieB2 && cookieB1 !== cookieB2);
  });

  await runCase("developer status is sanitized and a valid session may update protected settings", async () => {
    const anonymousStatus = await appRequest("/api/admin/developer-session");
    assert.deepEqual(anonymousStatus.data, { initialized: true, mustRotate: false, sessionValid: false });
    assert.doesNotMatch(JSON.stringify(anonymousStatus.data), /hash|salt|version/i);
    const sessionStatus = await appRequest("/api/admin/developer-session", { cookie: cookieB1 });
    assert.deepEqual(sessionStatus.data, { initialized: true, mustRotate: false, sessionValid: true });

    const store = await appRequest("/api/admin/settings", { cookie: cookieB1 });
    assert.equal(store.status, 200);
    assert.equal((await appRequest("/api/admin/settings", {
      method: "PUT", cookie: cookieB1, body: { business_name: store.data.business_name },
    })).status, 200);
    const legal = await appRequest("/api/admin/legal-settings", { cookie: cookieB1 });
    assert.equal(legal.status, 200);
    assert.equal((await appRequest("/api/admin/legal-settings", {
      method: "PUT", cookie: cookieB1, body: { settings: legal.data.record.settings },
    })).status, 200);
    const features = await appRequest("/api/admin/features", { cookie: cookieB1 });
    assert.equal(features.status, 200);
    assert.equal((await appRequest("/api/admin/features", {
      method: "PUT",
      cookie: cookieB1,
      body: { plan: features.data.settings.plan, features: features.data.settings.features },
    })).status, 200);
  });

  await runCase("failed rotation preserves the old credential and all old sessions", async () => {
    installCredentialFault("update");
    try {
      runCredentialCli("rotate", "client-b-test", { password: passwordC, expectFailure: true });
    } finally {
      uninstallCredentialFault();
    }
    const row = await developerRow();
    assert.equal(row.password_hash, hashB);
    assert.equal(row.password_version, versionB);
    assert.equal((await login(passwordB)).status, 200);
    assert.equal((await appRequest("/api/admin/settings", { cookie: cookieB1 })).status, 200);
    assert.equal((await appRequest("/api/admin/settings", { cookie: cookieB2 })).status, 200);
  });

  let cookieC;
  await runCase("successful rotation invalidates the old password and every old cookie", async () => {
    runCredentialCli("rotate", "client-b-test", { password: passwordC });
    const row = await developerRow();
    assert.equal(row.password_version, versionB + 1);
    assert.notEqual(row.credential_version, credentialVersionB);
    assert.equal(row.must_rotate, false);
    assert.ok(row.rotated_at);
    assert.equal((await login(passwordB)).status, 401);
    assert.equal((await appRequest("/api/admin/settings", { cookie: cookieB1 })).status, 401);
    assert.equal((await appRequest("/api/admin/settings", { cookie: cookieB2 })).status, 401);
    const current = await login(passwordC);
    assert.equal(current.status, 200);
    cookieC = current.cookie;
  });

  await runCase("stale repeated rotation is rejected without changing the current credential", async () => {
    const before = await developerRow();
    const { error } = await supabase.rpc("developer_credential_rotate_rpc", {
      p_password_hash: before.password_hash,
      p_credential_version: randomUUID(),
      p_expected_credential_version: credentialVersionB,
    });
    assert.ok(error);
    assert.match(error.message, /DEV_CREDENTIAL_CONFLICT/);
    const after = await developerRow();
    assert.equal(after.password_hash, before.password_hash);
    assert.equal(after.password_version, before.password_version);
  });

  await runCase("must-rotate disables password and cookies until service-role recovery", async () => {
    const { error } = await supabase.from("developer_access").update({ must_rotate: true }).eq("id", 1);
    if (error) throw error;
    assert.equal((await appRequest("/api/admin/settings", { cookie: cookieC })).status, 401);
    const blocked = await login(passwordC);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, "DEVELOPER_CREDENTIAL_ROTATION_REQUIRED");
    runCredentialCli("rotate", "client-b-test", { password: recoveryPassword });
    assert.equal((await login(passwordC)).status, 401);
    assert.equal((await login(recoveryPassword)).status, 200);
  });

  await runCase("CLI and API outputs never include test passwords or service role material", async () => {
    runCredentialCli("status", "client-b-test");
    const output = capturedOutputs.join("\n");
    for (const secret of [passwordA, passwordB, passwordC, recoveryPassword, local.SERVICE_ROLE_KEY]) {
      assert.ok(secret);
      assert.equal(output.includes(secret), false);
    }
    assert.doesNotMatch(output, /password_hash|credential_version|salt/i);
  });
} finally {
  await stopApp(server);
  try { uninstallCredentialFault(); } catch {}
  try { await deleteCredential(); } catch {}
  if (ownerAccount?.id) {
    try { await supabase.auth.admin.deleteUser(ownerAccount.id); } catch {}
  }
}

const failures = results.filter((result) => !result.ok);
console.log(`\nDeveloper credential integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) process.exitCode = 1;
