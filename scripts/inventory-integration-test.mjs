import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const REST_CONTAINER = "supabase_rest_clothing_web";
const KONG_CONTAINER = "supabase_kong_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3311;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PASSWORDS = {
  owner: "audit-inventory-owner",
  staff: "audit-inventory-staff",
  inventory: "audit-inventory-worker",
  readonly: "audit-inventory-readonly",
};
const AUDIT_PREFIX = "AUDIT-INV-";
const results = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
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
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`, "tests must use clothing_web local API");
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

function auditId(label) {
  return `${AUDIT_PREFIX}${label}-${randomUUID()}`;
}

function operationKey(kind, requestId) {
  return `${kind}:${requestId}`;
}

async function api(path, body, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (options.role) headers["x-admin-password"] = PASSWORDS[options.role];
  const response = await fetch(`${APP_URL}${path}`, {
    method: options.method || (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function adjust(fixture, requestId, input = {}, role = "owner") {
  return api("/api/admin/inventory/adjust", {
    variantId: input.variantId || fixture.variants[0].id,
    mode: input.mode || "adjust_by",
    quantity: input.quantity ?? 1,
    reason: input.reason || "Inventory integration adjustment",
    operationType: input.operationType || "manual",
    clientRequestId: requestId,
  }, { role });
}

async function quickSell(fixture, requestId, input = {}, options = { role: "owner" }) {
  const body = {
    sku: fixture.product.sku,
    size: input.size,
    variantId: input.variantId,
    variantSku: input.variantSku,
    barcode: input.barcode,
    quantity: input.quantity ?? 1,
    autoDeactivate: input.autoDeactivate !== false,
    clientRequestId: requestId,
  };
  return api("/api/admin/products/sell", body, options);
}

async function cleanupAuditData() {
  sql(`
    do $$
    begin
      if to_regclass('public.inventory_operations') is not null then
        delete from public.inventory_operations where operation_key like 'inventory:${AUDIT_PREFIX}%' or operation_key like 'quick_sell:${AUDIT_PREFIX}%';
      end if;
    end;
    $$;
    delete from public.stock_movements
    where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like '${AUDIT_PREFIX}%'
    );
    delete from public.inventory_balances
    where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like '${AUDIT_PREFIX}%'
    );
    delete from public.product_variants where product_id in (select id from public.products where sku like '${AUDIT_PREFIX}%');
    delete from public.products where sku like '${AUDIT_PREFIX}%';
  `);
}

async function createFixture(label, stocks, options = {}) {
  const token = auditId(label).replace(/[^A-Z0-9-]/gi, "").toUpperCase();
  const sizes = options.oneSize ? ["ONE SIZE"] : stocks.map((_, index) => `S${index + 1}`);
  const sizeStock = Object.fromEntries(sizes.map((size, index) => [size, stocks[index]]));
  const total = stocks.reduce((sum, quantity) => sum + quantity, 0);
  const { data: product, error: productError } = await supabase.from("products").insert({
    sku: token,
    name_cn: `Inventory audit ${label}`,
    name_en: `Inventory audit ${label}`,
    name_gr: `Inventory audit ${label}`,
    category: "audit",
    subcategory: "inventory",
    price: 10,
    stock: total,
    sizes: sizes.join(","),
    size_stock: sizeStock,
    is_active: options.productActive !== false,
  }).select("id, sku, stock, size_stock, is_active").single();
  if (productError) throw productError;

  const { data: location, error: locationError } = await supabase
    .from("inventory_locations").select("id").eq("code", "MAIN_STORE").single();
  if (locationError) throw locationError;

  const { data: variants, error: variantError } = await supabase.from("product_variants").insert(
    sizes.map((size, index) => ({
      product_id: product.id,
      variant_sku: `${token}-${size.replace(/\s+/g, "-")}`,
      barcode: `${token}-BARCODE-${index + 1}`,
      size,
      price: 10,
      active: options.variantActive !== false,
      sort_order: index,
    })),
  ).select("id, product_id, variant_sku, barcode, size, active");
  if (variantError) throw variantError;

  if (!options.missingBalance) {
    const { error: balanceError } = await supabase.from("inventory_balances").insert(
      variants.map((variant, index) => ({
        variant_id: variant.id,
        location_id: location.id,
        quantity_on_hand: stocks[index],
        quantity_reserved: Number(options.reserved?.[index] || 0),
      })),
    );
    if (balanceError) throw balanceError;

    const { error: movementError } = await supabase.from("stock_movements").insert(
      variants.map((variant, index) => ({
        variant_id: variant.id,
        location_id: location.id,
        movement_type: "initial_migration",
        quantity_delta: stocks[index],
        quantity_before: 0,
        quantity_after: stocks[index],
        reason: "Inventory integration fixture",
        source_type: "test_fixture",
        source_id: token,
        idempotency_key: `fixture:${token}:${variant.id}`,
        created_by: "inventory-integration-test",
      })),
    );
    if (movementError) throw movementError;
  }

  return { product, variants, location, stocks, sizes };
}

async function balance(variantId) {
  const { data, error } = await supabase.from("inventory_balances")
    .select("quantity_on_hand, quantity_reserved")
    .eq("variant_id", variantId).maybeSingle();
  if (error) throw error;
  return data;
}

async function productState(productId) {
  const { data, error } = await supabase.from("products")
    .select("stock, size_stock, sizes, is_active").eq("id", productId).single();
  if (error) throw error;
  return data;
}

async function movementsForKey(key) {
  const { data, error } = await supabase.from("stock_movements")
    .select("id, quantity_before, quantity_after, quantity_delta, idempotency_key, source_type, created_at")
    .eq("idempotency_key", key).order("created_at").order("id");
  if (error) throw error;
  return data;
}

async function movementsForVariant(variantId, sourceType) {
  let query = supabase.from("stock_movements")
    .select("id, quantity_before, quantity_after, quantity_delta, idempotency_key, source_type, created_at")
    .eq("variant_id", variantId).order("created_at").order("id");
  if (sourceType) query = query.eq("source_type", sourceType);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function operationForKey(key) {
  const { data, error } = await supabase.from("inventory_operations")
    .select("*").eq("operation_key", key).maybeSingle();
  if (error) throw error;
  return data;
}

async function assertProjection(fixture) {
  const balances = await Promise.all(fixture.variants.map((variant) => balance(variant.id)));
  const expected = Object.fromEntries(fixture.variants.map((variant, index) => [variant.size, Number(balances[index].quantity_on_hand)]));
  const product = await productState(fixture.product.id);
  assert.equal(Number(product.stock), Object.values(expected).reduce((sum, value) => sum + value, 0));
  assert.deepEqual(product.size_stock, expected);
}

async function assertNoOperationWrites(fixture, kind, requestId, before) {
  const key = operationKey(kind, requestId);
  assert.equal(await operationForKey(key), null);
  assert.equal((await movementsForKey(key)).length, 0);
  assert.deepEqual(await balance(fixture.variants[0].id), before.balance);
  assert.deepEqual(await productState(fixture.product.id), before.product);
}

function installFaultHarness() {
  sql(`
    drop schema if exists audit_inventory_test cascade;
    create schema audit_inventory_test;
    create table audit_inventory_test.config(stage text not null, operation_key text not null);
    create function audit_inventory_test.fail_selected_stage() returns trigger
    language plpgsql security definer set search_path = pg_catalog, public, audit_inventory_test as $$
    declare c audit_inventory_test.config%rowtype;
    begin
      select * into c from audit_inventory_test.config limit 1;
      if not found then return new; end if;
      if tg_table_name = 'inventory_operations' and tg_op = 'INSERT' and c.stage = 'operation_record'
         and new.operation_key = c.operation_key then raise exception 'AUDIT_INVENTORY_FAULT:operation_record'; end if;
      if tg_table_name = 'inventory_balances' and tg_op = 'UPDATE' and c.stage = 'inventory_balance'
         and exists (select 1 from public.product_variants v join public.products p on p.id=v.product_id where v.id=new.variant_id and p.sku like '${AUDIT_PREFIX}%')
         then raise exception 'AUDIT_INVENTORY_FAULT:inventory_balance'; end if;
      if tg_table_name = 'stock_movements' and tg_op = 'INSERT' and c.stage = 'stock_movement'
         and new.idempotency_key = c.operation_key then raise exception 'AUDIT_INVENTORY_FAULT:stock_movement'; end if;
      if tg_table_name = 'products' and tg_op = 'UPDATE' and c.stage = 'legacy_projection'
         and new.sku like '${AUDIT_PREFIX}%' then raise exception 'AUDIT_INVENTORY_FAULT:legacy_projection'; end if;
      return new;
    end;
    $$;
    create trigger audit_inventory_fail_operations before insert on public.inventory_operations for each row execute function audit_inventory_test.fail_selected_stage();
    create trigger audit_inventory_fail_balances before update on public.inventory_balances for each row execute function audit_inventory_test.fail_selected_stage();
    create trigger audit_inventory_fail_movements before insert on public.stock_movements for each row execute function audit_inventory_test.fail_selected_stage();
    create trigger audit_inventory_fail_products before update on public.products for each row execute function audit_inventory_test.fail_selected_stage();
  `);
}

function selectFault(stage, key) {
  sql(`truncate audit_inventory_test.config; insert into audit_inventory_test.config values ('${stage}', '${key}');`);
}

function clearFault() {
  sql("truncate audit_inventory_test.config;");
}

function uninstallFaultHarness() {
  sql(`
    drop trigger if exists audit_inventory_fail_operations on public.inventory_operations;
    drop trigger if exists audit_inventory_fail_balances on public.inventory_balances;
    drop trigger if exists audit_inventory_fail_movements on public.stock_movements;
    drop trigger if exists audit_inventory_fail_products on public.products;
    drop schema if exists audit_inventory_test cascade;
  `);
}

function setRpcExecute(granted) {
  const verb = granted ? "grant" : "revoke";
  const connector = granted ? "to" : "from";
  sql(`${verb} execute on function public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean) ${connector} service_role;`);
}

async function waitForRest() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${local.API_URL}/rest/v1/`, {
        headers: { apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}` },
      });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local PostgREST did not recover after the transport test.");
}

async function createOwnerAccount() {
  const email = `inventory-owner-${randomUUID()}@example.test`;
  const password = `Owner-${randomUUID()}-Aa1!`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error("owner user was not created");
  const { error: rowError } = await supabase.from("admin_users").insert({
    id: data.user.id,
    email,
    role: "owner",
    active: true,
    created_by: "inventory-integration-test",
  });
  if (rowError) throw rowError;
  const { data: session, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
  if (signInError || !session.session?.access_token) throw signInError || new Error("owner token missing");
  return { userId: data.user.id, token: session.session.access_token };
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
      ADMIN_PASSWORD: PASSWORDS.owner,
      ADMIN_STAFF_PASSWORD: PASSWORDS.staff,
      ADMIN_INVENTORY_PASSWORD: PASSWORDS.inventory,
      ADMIN_READONLY_PASSWORD: PASSWORDS.readonly,
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

async function prepareFeatureConfig() {
  const { data, error } = await supabase.from("feature_settings").select("plan, features, updated_by").eq("id", 1).single();
  if (error) throw error;
  const features = { ...data.features, inventory: true, quick_sell: true, staff_accounts: true };
  const { error: updateError } = await supabase.from("feature_settings")
    .update({ plan: "custom", features, updated_by: "inventory-integration-test" }).eq("id", 1);
  if (updateError) throw updateError;
  return data;
}

async function setQuickSellFeature(enabled) {
  const { data, error } = await supabase.from("feature_settings").select("features").eq("id", 1).single();
  if (error) throw error;
  const { error: updateError } = await supabase.from("feature_settings")
    .update({ features: { ...data.features, quick_sell: enabled }, updated_by: "inventory-integration-test" }).eq("id", 1);
  if (updateError) throw updateError;
}

let server;
let previousFeature;
let ownerAccount;
try {
  await cleanupAuditData();
  previousFeature = await prepareFeatureConfig();
  ownerAccount = await createOwnerAccount();
  server = await startApp();

  await runCase("20 different inventory IDs add one without lost updates", async () => {
    const fixture = await createFixture("ADJUST-CONCURRENT", [0]);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => adjust(fixture, auditId(`ADD-${index}`), { quantity: 1 })));
    assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 20);
    const movements = await movementsForVariant(fixture.variants[0].id, "admin_inventory_adjustment");
    assert.equal(movements.length, 20);
    assert.equal(movements.reduce((sum, movement) => sum + Number(movement.quantity_delta), 0), 20);
    assert.deepEqual(new Set(movements.map((movement) => Number(movement.quantity_before))), new Set(Array.from({ length: 20 }, (_, i) => i)));
    assert.deepEqual(new Set(movements.map((movement) => Number(movement.quantity_after))), new Set(Array.from({ length: 20 }, (_, i) => i + 1)));
    await assertProjection(fixture);
  });

  await runCase("20 replays of one inventory ID execute once", async () => {
    const fixture = await createFixture("ADJUST-SAME", [0]);
    const requestId = auditId("ADJUST-SAME");
    const responses = await Promise.all(Array.from({ length: 20 }, () => adjust(fixture, requestId, { quantity: 1 })));
    assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 1);
    assert.equal((await movementsForKey(operationKey("inventory", requestId))).length, 1);
    assert.ok(await operationForKey(operationKey("inventory", requestId)));
    assert.equal(new Set(responses.map((response) => response.data.operationId)).size, 1);
  });

  await runCase("20 concurrent decrements cannot make inventory negative", async () => {
    const fixture = await createFixture("ADJUST-LAST", [1]);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => adjust(fixture, auditId(`SUB-${index}`), { quantity: -1 })));
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 409).length, 19);
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 0);
    assert.equal((await movementsForVariant(fixture.variants[0].id, "admin_inventory_adjustment")).length, 1);
  });

  await runCase("concurrent set_to operations serialize into an explainable chain", async () => {
    const fixture = await createFixture("SET-CONCURRENT", [0]);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => adjust(fixture, auditId(`SET-${index}`), { mode: "set_to", quantity: index + 1 })));
    assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));
    const movements = await movementsForVariant(fixture.variants[0].id, "admin_inventory_adjustment");
    assert.equal(movements.length, 20);
    const byBefore = new Map(movements.map((movement) => [Number(movement.quantity_before), Number(movement.quantity_after)]));
    let current = 0;
    for (let index = 0; index < 20; index += 1) {
      assert.ok(byBefore.has(current), `missing serialized movement after ${current}`);
      current = byBefore.get(current);
    }
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), current);
    await assertProjection(fixture);
  });

  await runCase("receiving return and stocktake use explicit movement sources", async () => {
    const fixture = await createFixture("OPERATION-TYPES", [1]);
    assert.equal((await adjust(fixture, auditId("RECEIVING"), { operationType: "receiving", quantity: 2 })).status, 200);
    assert.equal((await adjust(fixture, auditId("RETURN"), { operationType: "return", quantity: 1 })).status, 200);
    assert.equal((await adjust(fixture, auditId("STOCKTAKE"), { operationType: "stocktake", mode: "set_to", quantity: 3 })).status, 200);
    const movements = await movementsForVariant(fixture.variants[0].id);
    assert.ok(movements.some((movement) => movement.source_type === "admin_receiving"));
    assert.ok(movements.some((movement) => movement.source_type === "admin_customer_return"));
    assert.ok(movements.some((movement) => movement.source_type === "admin_stocktake"));
    await assertProjection(fixture);
  });

  await runCase("reserved stock cannot be removed by adjustment or quick sell", async () => {
    const fixture = await createFixture("RESERVED", [5], { reserved: [3] });
    const adjustment = await adjust(fixture, auditId("RESERVED-ADJUST"), { quantity: -3 });
    const sale = await quickSell(fixture, auditId("RESERVED-SALE"), { quantity: 3 });
    assert.equal(adjustment.status, 409);
    assert.equal(sale.status, 409);
    assert.deepEqual(await balance(fixture.variants[0].id), { quantity_on_hand: 5, quantity_reserved: 3 });
  });

  await runCase("20 different quick sell IDs cannot oversell the last unit", async () => {
    const fixture = await createFixture("SELL-LAST", [1], { oneSize: true });
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => quickSell(fixture, auditId(`SELL-${index}`))));
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 409).length, 19);
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 0);
    assert.equal((await movementsForVariant(fixture.variants[0].id, "quick_sell")).length, 1);
    await assertProjection(fixture);
  });

  await runCase("20 concurrent quick sell replays return one result", async () => {
    const fixture = await createFixture("SELL-SAME", [2], { oneSize: true });
    const requestId = auditId("SELL-SAME");
    const responses = await Promise.all(Array.from({ length: 20 }, () => quickSell(fixture, requestId)));
    assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 1);
    assert.equal((await movementsForKey(operationKey("quick_sell", requestId))).length, 1);
    assert.equal(new Set(responses.map((response) => response.data.operationId)).size, 1);
  });

  await runCase("lost quick sell response retry returns the original result", async () => {
    const fixture = await createFixture("SELL-LOST", [2], { oneSize: true });
    const requestId = auditId("SELL-LOST");
    const first = await quickSell(fixture, requestId);
    const retry = await quickSell(fixture, requestId);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.alreadyProcessed, true);
    assert.equal(retry.data.operationId, first.data.operationId);
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 1);
  });

  await runCase("quick sell resolves size variant SKU and barcode without legacy stock reads", async () => {
    const fixture = await createFixture("SELL-RESOLVE", [2, 2, 2]);
    assert.equal((await quickSell(fixture, auditId("MISSING-SIZE"))).status, 400);
    assert.equal((await quickSell(fixture, auditId("BY-SIZE"), { size: fixture.variants[0].size })).status, 200);
    assert.equal((await quickSell(fixture, auditId("BY-SKU"), { sku: undefined, variantSku: fixture.variants[1].variant_sku })).status, 200);
    assert.equal((await quickSell(fixture, auditId("BY-BARCODE"), { sku: undefined, barcode: fixture.variants[2].barcode })).status, 200);
    await assertProjection(fixture);
  });

  await runCase("ONE SIZE quick sell works without an explicit size", async () => {
    const fixture = await createFixture("SELL-ONE-SIZE", [2], { oneSize: true });
    const response = await quickSell(fixture, auditId("ONE-SIZE"));
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.size, "ONE SIZE");
  });

  await runCase("inactive product inactive variant missing balance and insufficient stock write nothing", async () => {
    const cases = [
      await createFixture("INACTIVE-PRODUCT", [1], { oneSize: true, productActive: false }),
      await createFixture("INACTIVE-VARIANT", [1], { oneSize: true, variantActive: false }),
      await createFixture("MISSING-BALANCE", [1], { oneSize: true, missingBalance: true }),
      await createFixture("INSUFFICIENT", [0], { oneSize: true }),
    ];
    for (const [index, fixture] of cases.entries()) {
      const requestId = auditId(`INVALID-${index}`);
      const response = await quickSell(fixture, requestId);
      assert.ok([404, 409].includes(response.status), JSON.stringify(response.data));
      assert.equal(await operationForKey(operationKey("quick_sell", requestId)), null);
      assert.equal((await movementsForKey(operationKey("quick_sell", requestId))).length, 0);
    }
  });

  await runCase("quick sell permission matrix is owner-only", async () => {
    const fixture = await createFixture("PERMISSIONS", [10], { oneSize: true });
    const emergencyOwner = await quickSell(fixture, auditId("PASSWORD-OWNER"));
    const accountOwner = await quickSell(fixture, auditId("ACCOUNT-OWNER"), {}, { headers: { authorization: `Bearer ${ownerAccount.token}` } });
    assert.equal(emergencyOwner.status, 200);
    assert.equal(accountOwner.status, 200);
    for (const role of ["staff", "inventory", "readonly"]) {
      const response = await quickSell(fixture, auditId(`ROLE-${role}`), {}, { role });
      assert.equal(response.status, 403, `${role}: ${JSON.stringify(response.data)}`);
    }
    const unauthenticated = await quickSell(fixture, auditId("UNAUTH"), {}, {});
    assert.equal(unauthenticated.status, 401);
    assert.equal(Number((await balance(fixture.variants[0].id)).quantity_on_hand), 8);
  });

  await runCase("inventory role may adjust stock but not quick sell", async () => {
    const fixture = await createFixture("INVENTORY-ROLE", [1], { oneSize: true });
    assert.equal((await adjust(fixture, auditId("INVENTORY-WRITE"), { quantity: 1 }, "inventory")).status, 200);
    assert.equal((await quickSell(fixture, auditId("INVENTORY-SELL"), {}, { role: "inventory" })).status, 403);
  });

  await runCase("disabled Quick Sell feature blocks owner and writes nothing", async () => {
    const fixture = await createFixture("FEATURE-OFF", [2], { oneSize: true });
    const requestId = auditId("FEATURE-OFF");
    await setQuickSellFeature(false);
    try {
      const response = await quickSell(fixture, requestId);
      assert.equal(response.status, 403);
      assert.equal(response.data.code, "FEATURE_DISABLED");
      assert.equal(await operationForKey(operationKey("quick_sell", requestId)), null);
    } finally {
      await setQuickSellFeature(true);
    }
  });

  installFaultHarness();
  for (const stage of ["operation_record", "inventory_balance", "stock_movement", "legacy_projection"]) {
    await runCase(`inventory ${stage} fault rolls every write back`, async () => {
      const fixture = await createFixture(`FAULT-${stage}`, [2]);
      const requestId = auditId(`FAULT-${stage}`);
      const key = operationKey("inventory", requestId);
      const before = { balance: await balance(fixture.variants[0].id), product: await productState(fixture.product.id) };
      selectFault(stage, key);
      try {
        const response = await adjust(fixture, requestId, { quantity: 1 });
        assert.equal(response.status, 503, JSON.stringify(response.data));
        await assertNoOperationWrites(fixture, "inventory", requestId, before);
      } finally {
        clearFault();
      }
    });
  }
  uninstallFaultHarness();

  await runCase("missing inventory RPC execute permission fails closed", async () => {
    const fixture = await createFixture("RPC-PERMISSION", [2]);
    const requestId = auditId("RPC-PERMISSION");
    const before = { balance: await balance(fixture.variants[0].id), product: await productState(fixture.product.id) };
    setRpcExecute(false);
    try {
      const response = await adjust(fixture, requestId, { quantity: 1 });
      assert.equal(response.status, 503, JSON.stringify(response.data));
      await assertNoOperationWrites(fixture, "inventory", requestId, before);
    } finally {
      setRpcExecute(true);
    }
  });

  await runCase("local PostgREST transport failure returns 503 without writes", async () => {
    const fixture = await createFixture("RPC-TRANSPORT", [2]);
    const requestId = auditId("RPC-TRANSPORT");
    const before = { balance: await balance(fixture.variants[0].id), product: await productState(fixture.product.id) };
    command("docker", ["stop", REST_CONTAINER]);
    try {
      const response = await adjust(fixture, requestId, { quantity: 1 });
      assert.equal(response.status, 503, JSON.stringify(response.data));
    } finally {
      command("docker", ["start", REST_CONTAINER]);
      command("docker", ["restart", KONG_CONTAINER]);
      await waitForRest();
    }
    await assertNoOperationWrites(fixture, "inventory", requestId, before);
  });

  await runCase("reconciliation detects movement arithmetic and latest-balance mismatches", async () => {
    const fixture = await createFixture("RECONCILIATION", [2]);
    const variant = fixture.variants[0];
    const key = auditId("BAD-MOVEMENT");
    const { error } = await supabase.from("stock_movements").insert({
      variant_id: variant.id,
      location_id: fixture.location.id,
      movement_type: "correction",
      quantity_delta: 1,
      quantity_before: 2,
      quantity_after: 99,
      reason: "Intentional read-only health fixture",
      source_type: "test_reconciliation",
      source_id: key,
      idempotency_key: key,
      created_by: "inventory-integration-test",
    });
    if (error) throw error;
    const response = await api("/api/admin/inventory/reconciliation", undefined, { role: "owner" });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.ok(response.data.movementDeltaMismatches.some((item) => item.movement_id));
    assert.ok(response.data.balanceVsLatestMovementMismatches.some((item) => item.variant_id === variant.id));
    assert.ok(Array.isArray(response.data.duplicateOperationKeys));
    assert.ok(Array.isArray(response.data.negativeBalances));
  });
} finally {
  await stopApp(server);
  try { uninstallFaultHarness(); } catch {}
  try { setRpcExecute(true); } catch {}
  try {
    command("docker", ["start", REST_CONTAINER]);
    command("docker", ["restart", KONG_CONTAINER]);
    await waitForRest();
  } catch {}
  try { await cleanupAuditData(); } catch {}
  if (ownerAccount?.userId) {
    try { await supabase.auth.admin.deleteUser(ownerAccount.userId); } catch {}
  }
  if (previousFeature) {
    try { await supabase.from("feature_settings").update(previousFeature).eq("id", 1); } catch {}
  }
}

const failures = results.filter((result) => !result.ok);
console.log(`\nInventory integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) {
  console.error(`Failed cases: ${failures.map((failure) => failure.name).join(", ")}`);
  process.exitCode = 1;
}
