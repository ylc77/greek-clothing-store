import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const DB_CONTAINER = "supabase_db_clothing_web";
const PREFIX = `AUDIT_AI_AUTH_${randomUUID().replaceAll("-", "")}`;

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) {
    if (options.sensitiveOutput) throw new Error(`${name} failed; sensitive output suppressed.`);
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`);
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
});
const anon = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tableNames = [
  "security_rate_limit_buckets",
  "ai_usage_daily",
  "ai_request_leases",
  "security_auth_limits",
];
const functions = [
  "public.ai_rate_limit_begin_rpc(uuid,text,jsonb,jsonb,integer,integer,integer)",
  "public.ai_rate_limit_finish_rpc(uuid,text,integer)",
  "public.auth_rate_limit_status_rpc(text,text)",
  "public.auth_rate_limit_record_rpc(text,text,boolean,integer,integer,integer,integer)",
];

async function rpc(name, args) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data;
}

try {
  for (const table of tableNames) {
    assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass;`), "t");
    assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename='${table}';`), "0");
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_table_privilege('${role}','public.${table}','select');`), "f");
      assert.equal(sql(`select has_table_privilege('${role}','public.${table}','insert');`), "f");
      assert.equal(sql(`select has_table_privilege('${role}','public.${table}','update');`), "f");
      assert.equal(sql(`select has_table_privilege('${role}','public.${table}','delete');`), "f");
    }
    for (const privilege of ["select", "insert", "update", "delete"]) {
      assert.equal(sql(`select has_table_privilege('service_role','public.${table}','${privilege}');`), "t");
    }
  }

  for (const signature of functions) {
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_function_privilege('${role}','${signature}','execute');`), "f");
    }
    assert.equal(sql(`select has_function_privilege('service_role','${signature}','execute');`), "t");
    const searchPath = sql(`select array_to_string(proconfig, ',') from pg_proc where oid='${signature}'::regprocedure;`);
    assert.match(searchPath, /search_path=/);
  }

  assert.equal(sql("select indisunique from pg_index where indexrelid='public.admin_users_email_ci_unique_idx'::regclass;"), "t");
  assert.equal(sql("select count(*) from pg_constraint where conrelid='public.admin_users'::regclass and conname='admin_users_email_normalized_check';"), "1");

  const { error: anonRpcError } = await anon.rpc("auth_rate_limit_status_rpc", {
    p_namespace: `${PREFIX}_anon`,
    p_subject_hash: `${PREFIX}_anon`,
  });
  assert.ok(anonRpcError, "anon unexpectedly executed an authentication limiter RPC");
  assert.equal(anonRpcError.code, "42501");

  const authNamespace = `${PREFIX}_auth`;
  const authSubject = `${PREFIX}_subject`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await rpc("auth_rate_limit_record_rpc", {
      p_namespace: authNamespace,
      p_subject_hash: authSubject,
      p_success: false,
      p_max_failures: 3,
      p_window_seconds: 600,
      p_block_seconds: 600,
      p_capacity: 10,
    });
    assert.equal(result.allowed, attempt < 3);
  }
  const blocked = await rpc("auth_rate_limit_status_rpc", {
    p_namespace: authNamespace,
    p_subject_hash: authSubject,
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retry_after > 0);
  const cleared = await rpc("auth_rate_limit_record_rpc", {
    p_namespace: authNamespace,
    p_subject_hash: authSubject,
    p_success: true,
    p_max_failures: 3,
    p_window_seconds: 600,
    p_block_seconds: 600,
    p_capacity: 10,
  });
  assert.equal(cleared.allowed, true);

  for (let index = 0; index < 15; index += 1) {
    await rpc("auth_rate_limit_record_rpc", {
      p_namespace: `${PREFIX}_capacity`,
      p_subject_hash: `${PREFIX}_capacity_${index}`,
      p_success: false,
      p_max_failures: 5,
      p_window_seconds: 600,
      p_block_seconds: 600,
      p_capacity: 10,
    });
  }
  assert.equal(sql(`select count(*) from public.security_auth_limits where namespace='${PREFIX}_capacity';`), "10");

  const begin = (requestId, store, subjects, limits, daily = 100, concurrency = 10) => rpc("ai_rate_limit_begin_rpc", {
    p_request_id: requestId,
    p_store_key: store,
    p_subjects: subjects,
    p_limits: limits,
    p_daily_limit: daily,
    p_concurrency_limit: concurrency,
    p_input_characters: 100,
  });
  const finish = (requestId, status = "completed") => rpc("ai_rate_limit_finish_rpc", {
    p_request_id: requestId,
    p_status: status,
    p_output_characters: 50,
  });

  const concurrentStore = `${PREFIX}_concurrency`;
  const firstLease = randomUUID();
  const first = await begin(firstLease, concurrentStore, { ip: `${PREFIX}_ip1` }, { ip: 10 }, 100, 1);
  assert.equal(first.allowed, true);
  const second = await begin(randomUUID(), concurrentStore, { ip: `${PREFIX}_ip2` }, { ip: 10 }, 100, 1);
  assert.equal(second.code, "AI_CONCURRENCY_LIMIT");
  assert.equal(await finish(firstLease), true);

  const rateStore = `${PREFIX}_rate`;
  const rateSubjects = { ip: `${PREFIX}_same_ip` };
  const rateLease = randomUUID();
  assert.equal((await begin(rateLease, rateStore, rateSubjects, { ip: 1 })).allowed, true);
  assert.equal(await finish(rateLease), true);
  const rateBlocked = await begin(randomUUID(), rateStore, rateSubjects, { ip: 1 });
  assert.equal(rateBlocked.code, "AI_RATE_LIMITED");

  const budgetStore = `${PREFIX}_budget`;
  const budgetLease = randomUUID();
  assert.equal((await begin(budgetLease, budgetStore, { ip: `${PREFIX}_budget_1` }, { ip: 10 }, 1)).allowed, true);
  assert.equal(await finish(budgetLease), true);
  const budgetBlocked = await begin(randomUUID(), budgetStore, { ip: `${PREFIX}_budget_2` }, { ip: 10 }, 1);
  assert.equal(budgetBlocked.code, "AI_DAILY_BUDGET_EXHAUSTED");

  const replayId = randomUUID();
  const replayStore = `${PREFIX}_replay`;
  assert.equal((await begin(replayId, replayStore, { ip: `${PREFIX}_replay_ip` }, { ip: 10 })).allowed, true);
  assert.equal((await begin(replayId, replayStore, { ip: `${PREFIX}_replay_ip` }, { ip: 10 })).code, "AI_REQUEST_ALREADY_STARTED");
  assert.equal(await finish(replayId, "failed"), true);

  assert.equal(sql(`select count(*) from public.security_auth_limits where subject_hash like '%${PREFIX}%';`), "10");
  assert.equal(sql(`select count(*) from public.ai_request_leases where store_key like '${PREFIX}%';`), "4");
  console.log("AI/auth database security, shared limits, budgets, concurrency, replay, and capacity passed.");
} finally {
  sql(`
    delete from public.security_auth_limits where namespace like '${PREFIX}%';
    delete from public.security_rate_limit_buckets where subject_hash like '${PREFIX}%';
    delete from public.ai_request_leases where store_key like '${PREFIX}%';
    delete from public.ai_usage_daily where store_key like '${PREFIX}%';
  `);
  assert.equal(sql(`select count(*) from public.security_auth_limits where namespace like '${PREFIX}%';`), "0");
  assert.equal(sql(`select count(*) from public.ai_request_leases where store_key like '${PREFIX}%';`), "0");
}
