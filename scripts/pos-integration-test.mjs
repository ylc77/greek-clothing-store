import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3310;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const ADMIN_PASSWORD = "AuditPosOwner!2026-Alpha";
const AUTH_RATE_LIMIT_SECRET = "test-only-pos-auth-rate-limit-secret-2026";
const AUDIT_PREFIX = "AUDIT-POS-";
const results = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
    shell: options.shell === true,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(`${name} ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}\n${result.stdout || ""}\n${result.stderr || ""}`);
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
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`), "tests must use clothing_web local DB");
  assert.ok(values.ANON_KEY, "local anon key is missing");
  assert.ok(values.SERVICE_ROLE_KEY, "local service-role key is missing");
  return values;
}

const local = readLocalEnvironment();
const supabase = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
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

async function cleanupAuditData() {
  sql(`
    delete from public.payments
    where order_id in (select id from public.sales_orders where idempotency_key like 'pos_sale:${AUDIT_PREFIX}%');
    delete from public.stock_movements
    where variant_id in (
      select v.id from public.product_variants v
      join public.products p on p.id = v.product_id
      where p.sku like '${AUDIT_PREFIX}%'
    );
    delete from public.sales_order_items
    where order_id in (select id from public.sales_orders where idempotency_key like 'pos_sale:${AUDIT_PREFIX}%');
    delete from public.sales_orders where idempotency_key like 'pos_sale:${AUDIT_PREFIX}%';
    delete from public.inventory_balances
    where variant_id in (
      select v.id from public.product_variants v
      join public.products p on p.id = v.product_id
      where p.sku like '${AUDIT_PREFIX}%'
    );
    delete from public.product_variants
    where product_id in (select id from public.products where sku like '${AUDIT_PREFIX}%');
    delete from public.products where sku like '${AUDIT_PREFIX}%';
  `);
}

async function createFixture(label, stocks) {
  const token = auditId(label).replace(/[^A-Z0-9-]/gi, "").toUpperCase();
  const sizes = stocks.map((_, index) => `S${index + 1}`);
  const sizeStock = Object.fromEntries(sizes.map((size, index) => [size, stocks[index]]));
  const total = stocks.reduce((sum, value) => sum + value, 0);
  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({
      sku: token,
      name_cn: `POS audit ${label}`,
      name_en: `POS audit ${label}`,
      name_gr: `POS audit ${label}`,
      category: "audit",
      subcategory: "pos",
      price: 10,
      stock: total,
      sizes: sizes.join(","),
      size_stock: sizeStock,
      is_active: true,
    })
    .select("id, sku")
    .single();
  if (productError) throw productError;

  const { data: location, error: locationError } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("code", "MAIN_STORE")
    .single();
  if (locationError) throw locationError;

  const variantsToInsert = sizes.map((size, index) => ({
    product_id: product.id,
    variant_sku: `${token}-${size}`,
    barcode: `${token}-${index + 1}`,
    size,
    price: 10,
    active: true,
    sort_order: index,
  }));
  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .insert(variantsToInsert)
    .select("id, product_id, variant_sku, size");
  if (variantsError) throw variantsError;

  const { error: balancesError } = await supabase.from("inventory_balances").insert(
    variants.map((variant, index) => ({
      variant_id: variant.id,
      location_id: location.id,
      quantity_on_hand: stocks[index],
      quantity_reserved: 0,
    })),
  );
  if (balancesError) throw balancesError;

  return { product, variants, location, stocks };
}

async function checkout(requestId, fixture, quantities = fixture.variants.map(() => 1)) {
  return api("/api/admin/pos/checkout", {
    clientRequestId: requestId,
    paymentMethod: "cash",
    discountTotal: 0,
    notes: "POS transaction audit",
    items: fixture.variants.map((variant, index) => ({
      variantId: variant.id,
      quantity: quantities[index],
    })),
  });
}

async function voidOrder(orderId, requestId, reason = "POS audit void") {
  return api(`/api/admin/pos/orders/${orderId}/void`, {
    clientRequestId: requestId,
    reason,
  });
}

async function api(path, body, method = "POST") {
  const response = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-password": ADMIN_PASSWORD,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function queryOrder(requestId) {
  const { data, error } = await supabase
    .from("sales_orders")
    .select("*, sales_order_items(*), payments(*)")
    .eq("idempotency_key", `pos_sale:${requestId}`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function balances(fixture) {
  const { data, error } = await supabase
    .from("inventory_balances")
    .select("variant_id, quantity_on_hand, quantity_reserved")
    .in("variant_id", fixture.variants.map((variant) => variant.id));
  if (error) throw error;
  return new Map(data.map((row) => [row.variant_id, Number(row.quantity_on_hand)]));
}

async function assertBalances(fixture, expected) {
  const current = await balances(fixture);
  fixture.variants.forEach((variant, index) => {
    assert.equal(current.get(variant.id), expected[index], `unexpected balance for ${variant.variant_sku}`);
  });
}

async function movements(orderId, sourceType) {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("variant_id, quantity_delta, quantity_before, quantity_after, source_type, source_id, created_by")
    .eq("source_type", sourceType)
    .eq("source_id", orderId);
  if (error) throw error;
  return data;
}

async function assertLegacyProjection(fixture) {
  const currentBalances = await balances(fixture);
  const expectedStock = [...currentBalances.values()].reduce((sum, value) => sum + value, 0);
  const expectedSizeStock = Object.fromEntries(
    fixture.variants.map((variant) => [variant.size, currentBalances.get(variant.id)]),
  );
  const { data: product, error } = await supabase
    .from("products")
    .select("stock, size_stock")
    .eq("id", fixture.product.id)
    .single();
  if (error) throw error;
  assert.equal(Number(product.stock), expectedStock);
  assert.deepEqual(product.size_stock, expectedSizeStock);
}

async function assertNoCheckoutWrites(requestId, fixture) {
  assert.equal(await queryOrder(requestId), null, "order must not exist");
  const current = await balances(fixture);
  fixture.variants.forEach((variant, index) => {
    assert.equal(current.get(variant.id), fixture.stocks[index], "inventory balance changed");
  });
  const { count, error } = await supabase
    .from("stock_movements")
    .select("id", { count: "exact", head: true })
    .like("idempotency_key", `pos_sale:${requestId}:%`);
  if (error) throw error;
  assert.equal(count, 0, "sale movement must not exist");
  await assertLegacyProjection(fixture);
}

function installFaultHarness() {
  sql(`
    drop trigger if exists audit_pos_fail_orders on public.sales_orders;
    drop trigger if exists audit_pos_fail_items on public.sales_order_items;
    drop trigger if exists audit_pos_fail_payments on public.payments;
    drop trigger if exists audit_pos_fail_balances on public.inventory_balances;
    drop trigger if exists audit_pos_fail_movements on public.stock_movements;
    drop schema if exists audit_pos_test cascade;
    create schema audit_pos_test;
    create table audit_pos_test.config (
      stage text not null,
      request_id text,
      variant_id uuid,
      order_id uuid
    );
    create function audit_pos_test.fail_selected_stage()
    returns trigger
    language plpgsql
    set search_path = pg_catalog, public, audit_pos_test
    as $$
    declare c audit_pos_test.config%rowtype;
    begin
      select * into c from audit_pos_test.config limit 1;
      if not found then return new; end if;
      if tg_table_name = 'sales_orders' and tg_op = 'INSERT'
         and c.stage = 'sales_orders'
         and to_jsonb(new)->>'idempotency_key' = 'pos_sale:' || c.request_id then
        raise exception 'AUDIT_POS_FAULT:sales_orders';
      end if;
      if tg_table_name = 'sales_order_items' and tg_op = 'INSERT'
         and c.stage = 'sales_order_items'
         and exists (select 1 from public.sales_orders o where o.id = (to_jsonb(new)->>'order_id')::uuid and o.idempotency_key = 'pos_sale:' || c.request_id) then
        raise exception 'AUDIT_POS_FAULT:sales_order_items';
      end if;
      if tg_table_name = 'payments' and tg_op = 'INSERT'
         and c.stage = 'payments_insert'
         and exists (select 1 from public.sales_orders o where o.id = (to_jsonb(new)->>'order_id')::uuid and o.idempotency_key = 'pos_sale:' || c.request_id) then
        raise exception 'AUDIT_POS_FAULT:payments_insert';
      end if;
      if tg_table_name = 'inventory_balances' and tg_op = 'UPDATE'
         and c.stage = 'inventory_balances_sale'
         and (to_jsonb(new)->>'variant_id')::uuid = c.variant_id
         and (to_jsonb(new)->>'quantity_on_hand')::integer < (to_jsonb(old)->>'quantity_on_hand')::integer then
        raise exception 'AUDIT_POS_FAULT:inventory_balances_sale';
      end if;
      if tg_table_name = 'stock_movements' and tg_op = 'INSERT'
         and c.stage = 'stock_movements_sale'
         and to_jsonb(new)->>'idempotency_key' like 'pos_sale:' || c.request_id || ':%' then
        raise exception 'AUDIT_POS_FAULT:stock_movements_sale';
      end if;
      if tg_table_name = 'stock_movements' and tg_op = 'INSERT'
         and c.stage = 'stock_movements_void'
         and to_jsonb(new)->>'source_type' = 'pos_void' and to_jsonb(new)->>'source_id' = c.order_id::text then
        raise exception 'AUDIT_POS_FAULT:stock_movements_void';
      end if;
      if tg_table_name = 'payments' and tg_op = 'UPDATE'
         and c.stage = 'payments_void'
         and (to_jsonb(new)->>'order_id')::uuid = c.order_id and to_jsonb(new)->>'status' = 'voided' then
        raise exception 'AUDIT_POS_FAULT:payments_void';
      end if;
      return new;
    end;
    $$;
    create trigger audit_pos_fail_orders before insert on public.sales_orders for each row execute function audit_pos_test.fail_selected_stage();
    create trigger audit_pos_fail_items before insert on public.sales_order_items for each row execute function audit_pos_test.fail_selected_stage();
    create trigger audit_pos_fail_payments before insert or update on public.payments for each row execute function audit_pos_test.fail_selected_stage();
    create trigger audit_pos_fail_balances before update on public.inventory_balances for each row execute function audit_pos_test.fail_selected_stage();
    create trigger audit_pos_fail_movements before insert on public.stock_movements for each row execute function audit_pos_test.fail_selected_stage();
  `);
}

function clearFault() {
  sql("truncate table audit_pos_test.config;");
}

function selectFault(stage, { requestId = null, variantId = null, orderId = null } = {}) {
  const value = (input, cast = "text") => input ? `'${input}'::${cast}` : `null::${cast}`;
  sql(`
    truncate table audit_pos_test.config;
    insert into audit_pos_test.config(stage, request_id, variant_id, order_id)
    values ('${stage}', ${value(requestId)}, ${value(variantId, "uuid")}, ${value(orderId, "uuid")});
  `);
}

function uninstallFaultHarness() {
  sql(`
    drop trigger if exists audit_pos_fail_orders on public.sales_orders;
    drop trigger if exists audit_pos_fail_items on public.sales_order_items;
    drop trigger if exists audit_pos_fail_payments on public.payments;
    drop trigger if exists audit_pos_fail_balances on public.inventory_balances;
    drop trigger if exists audit_pos_fail_movements on public.stock_movements;
    drop schema if exists audit_pos_test cascade;
  `);
}

function setCheckoutExecute(granted) {
  const action = granted ? "grant execute" : "revoke execute";
  const connector = granted ? "to" : "from";
  sql(`
    do $$
    declare fn regprocedure;
    begin
      for fn in
        select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'pos_checkout_rpc' and p.pronargs = 9
      loop
        execute format('${action} on function %s ${connector} service_role', fn);
      end loop;
    end;
    $$;
  `);
}

async function startApp(useRpc) {
  const logs = [];
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      ADMIN_PASSWORD,
      AUTH_RATE_LIMIT_SECRET,
      USE_POS_RPC: useRpc ? "true" : "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev exited early\n${logs.join("")}`);
    try {
      const response = await fetch(`${APP_URL}/admin`, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) return { child, logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopApp({ child, logs });
  throw new Error(`Timed out waiting for Next dev\n${logs.join("")}`);
}

async function stopApp(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    server.child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function prepareConfig() {
  const { data: feature, error } = await supabase
    .from("feature_settings")
    .select("plan, features, updated_by")
    .eq("id", 1)
    .single();
  if (error) throw error;
  const previousFeature = feature;
  const features = { ...feature.features, pos_checkout: true, pos_orders: true, pos_void: true };
  const { error: updateError } = await supabase
    .from("feature_settings")
    .update({ plan: "custom", features, updated_by: "pos-integration-test" })
    .eq("id", 1);
  if (updateError) throw updateError;

  const { data: currentLegal, error: legalReadError } = await supabase
    .from("legal_settings_versions")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (legalReadError) throw legalReadError;
  const auditVersion = 900000 + Math.floor(Math.random() * 9999);
  await supabase.from("legal_settings_versions").update({ is_current: false }).eq("is_current", true);
  const { error: legalInsertError } = await supabase.from("legal_settings_versions").insert({
    version_number: auditVersion,
    version_label: `v${auditVersion}`,
    snapshot: { projectType: "retail", businessName: "POS Audit" },
    is_current: true,
    published_by: "pos-integration-test",
  });
  if (legalInsertError) throw legalInsertError;

  return {
    previousFeature,
    previousLegalId: currentLegal?.id || null,
    auditVersion,
  };
}

async function restoreConfig(config) {
  await supabase
    .from("feature_settings")
    .update(config.previousFeature)
    .eq("id", 1);
  await supabase
    .from("legal_settings_versions")
    .delete()
    .eq("version_number", config.auditVersion);
  if (config.previousLegalId) {
    await supabase
      .from("legal_settings_versions")
      .update({ is_current: true })
      .eq("id", config.previousLegalId);
  }
}

async function simulatePartialVoid(orderId, fixture, restoredIndex, restoredQuantity, markVoided) {
  const variant = fixture.variants[restoredIndex];
  const current = await balances(fixture);
  const before = current.get(variant.id);
  const after = before + restoredQuantity;
  const key = auditId("LEGACY-VOID");
  sql(`
    update public.inventory_balances
    set quantity_on_hand = ${after}, updated_at = now()
    where variant_id = '${variant.id}'::uuid and location_id = '${fixture.location.id}'::uuid;
    insert into public.stock_movements (
      variant_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key, created_by
    ) values (
      '${variant.id}'::uuid, '${fixture.location.id}'::uuid, 'return', ${restoredQuantity}, ${before}, ${after},
      'legacy partial void fixture', 'pos_void', '${orderId}', '${key}', 'legacy-admin'
    );
    select app_private.pos_sync_legacy_stock_from_erp(${fixture.product.id});
    ${markVoided ? `
      update public.sales_orders set status = 'voided', payment_status = 'voided', voided_at = now() where id = '${orderId}'::uuid;
      update public.payments set status = 'voided' where order_id = '${orderId}'::uuid;
    ` : ""}
  `);
}

let config;
let server;
try {
  await cleanupAuditData();
  config = await prepareConfig();
  // A previous integration process may have persisted a disabled feature
  // snapshot in Next's disk cache. The database fixture above is authoritative
  // for this isolated run, so clear only this repository's cache before boot.
  fs.rmSync(path.join(ROOT, ".next", "cache"), { recursive: true, force: true });

  server = await startApp(false);
  await runCase("checkout fails closed when USE_POS_RPC is false", async () => {
    const fixture = await createFixture("RPC-DISABLED", [2]);
    const requestId = auditId("RPC-DISABLED");
    const response = await checkout(requestId, fixture);
    assert.equal(response.status, 503);
    assert.equal(response.data.code, "POS_RPC_REQUIRED");
    await assertNoCheckoutWrites(requestId, fixture);
  });
  await runCase("admin POS health reports a blocking RPC configuration error", async () => {
    const response = await api("/api/admin/pos/health", undefined, "GET");
    assert.equal(response.status, 503);
    assert.equal(response.data.ready, false);
  });
  await stopApp(server);
  server = await startApp(true);

  installFaultHarness();

  await runCase("transactional checkout writes one complete legal-versioned result", async () => {
    const fixture = await createFixture("CHECKOUT", [3, 2]);
    const requestId = auditId("CHECKOUT");
    const response = await checkout(requestId, fixture, [1, 2]);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const order = await queryOrder(requestId);
    assert.ok(order);
    assert.equal(order.sales_order_items.length, 2);
    assert.equal(order.payments.length, 1);
    assert.equal(order.legal_terms_version, `v${config.auditVersion}`);
    assert.equal(order.privacy_policy_version, `v${config.auditVersion}`);
    assert.ok(order.legal_accepted_at);
    assert.equal(order.created_by, "password:owner");
    assert.equal((await movements(order.id, "pos_sale")).length, 2);
    await assertLegacyProjection(fixture);
  });

  await runCase("same checkout request ID is concurrent and replay idempotent", async () => {
    const fixture = await createFixture("CHECKOUT-SAME", [5]);
    const requestId = auditId("CHECKOUT-SAME");
    const responses = await Promise.all(Array.from({ length: 8 }, () => checkout(requestId, fixture)));
    assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));
    const orderIds = new Set(responses.map((response) => response.data.order?.id));
    assert.equal(orderIds.size, 1);
    const order = await queryOrder(requestId);
    assert.equal(order.sales_order_items.length, 1);
    assert.equal(order.payments.length, 1);
    assert.equal((await movements(order.id, "pos_sale")).length, 1);
    assert.equal((await balances(fixture)).get(fixture.variants[0].id), 4);
  });

  await runCase("two checkout IDs cannot oversell the last unit", async () => {
    const fixture = await createFixture("CHECKOUT-LAST", [1]);
    const first = auditId("CHECKOUT-LAST-A");
    const second = auditId("CHECKOUT-LAST-B");
    const responses = await Promise.all([checkout(first, fixture), checkout(second, fixture)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await balances(fixture)).get(fixture.variants[0].id), 0);
    const orders = [await queryOrder(first), await queryOrder(second)].filter(Boolean);
    assert.equal(orders.length, 1);
  });

  await runCase("lost checkout response retries return the original order", async () => {
    const fixture = await createFixture("CHECKOUT-LOST", [2]);
    const requestId = auditId("CHECKOUT-LOST");
    const first = await checkout(requestId, fixture);
    assert.equal(first.status, 200);
    const retry = await checkout(requestId, fixture);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.order.id, first.data.order.id);
    assert.equal(retry.data.alreadyProcessed, true);
    assert.equal((await balances(fixture)).get(fixture.variants[0].id), 1);
  });

  for (const stage of ["sales_order_items", "payments_insert", "inventory_balances_sale", "stock_movements_sale"]) {
    await runCase(`checkout ${stage} fault rolls every table back`, async () => {
      const fixture = await createFixture(`FAULT-${stage}`, [2]);
      const requestId = auditId(`FAULT-${stage}`);
      selectFault(stage, { requestId, variantId: fixture.variants[0].id });
      try {
        const response = await checkout(requestId, fixture);
        await assertNoCheckoutWrites(requestId, fixture);
        assert.equal(response.status, 503, JSON.stringify(response.data));
      } finally {
        clearFault();
      }
    });
  }

  await runCase("missing checkout execute privilege is fail closed", async () => {
    const fixture = await createFixture("RPC-PRIVILEGE", [2]);
    const requestId = auditId("RPC-PRIVILEGE");
    setCheckoutExecute(false);
    try {
      const response = await checkout(requestId, fixture);
      assert.equal(response.status, 503, JSON.stringify(response.data));
      await assertNoCheckoutWrites(requestId, fixture);
      const health = await api("/api/admin/pos/health", undefined, "GET");
      assert.equal(health.status, 503);
      assert.equal(health.data.ready, false);
    } finally {
      setCheckoutExecute(true);
    }
  });

  await runCase("multi-variant void and same-ID replay restore exactly once", async () => {
    const fixture = await createFixture("VOID-SAME", [3, 4]);
    const saleId = auditId("VOID-SAME-SALE");
    const sale = await checkout(saleId, fixture, [1, 2]);
    assert.equal(sale.status, 200);
    const voidId = auditId("VOID-SAME");
    const first = await voidOrder(sale.data.order.id, voidId);
    const retry = await voidOrder(sale.data.order.id, voidId);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.equal(retry.data.alreadyProcessed, true);
    await assertBalances(fixture, [3, 4]);
    assert.equal((await movements(sale.data.order.id, "pos_void")).length, 2);
    await assertLegacyProjection(fixture);
  });

  await runCase("different concurrent void IDs restore exactly once", async () => {
    const fixture = await createFixture("VOID-CONCURRENT", [2, 2]);
    const sale = await checkout(auditId("VOID-CONCURRENT-SALE"), fixture);
    assert.equal(sale.status, 200);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) => voidOrder(sale.data.order.id, auditId(`VOID-CONCURRENT-${index}`))),
    );
    assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));
    await assertBalances(fixture, [2, 2]);
    assert.equal((await movements(sale.data.order.id, "pos_void")).length, 2);
  });

  for (const markVoided of [false, true]) {
    await runCase(`legacy partial void is completed per variant${markVoided ? " even when falsely marked voided" : ""}`, async () => {
      const fixture = await createFixture(`VOID-PARTIAL-${markVoided}`, [3, 3]);
      const sale = await checkout(auditId(`VOID-PARTIAL-SALE-${markVoided}`), fixture);
      assert.equal(sale.status, 200);
      await simulatePartialVoid(sale.data.order.id, fixture, 0, 1, markVoided);
      const response = await voidOrder(sale.data.order.id, auditId(`VOID-PARTIAL-${markVoided}`));
      assert.equal(response.status, 200, JSON.stringify(response.data));
      await assertBalances(fixture, [3, 3]);
      const restored = await movements(sale.data.order.id, "pos_void");
      assert.equal(restored.length, 2);
      assert.deepEqual(new Map(restored.map((movement) => [movement.variant_id, Number(movement.quantity_delta)])), new Map(fixture.variants.map((variant) => [variant.id, 1])));
      const { data: persisted } = await supabase.from("sales_orders").select("status, payment_status").eq("id", sale.data.order.id).single();
      assert.equal(persisted.status, "voided");
      assert.equal(persisted.payment_status, "voided");
      await assertLegacyProjection(fixture);
    });
  }

  await runCase("over-restored legacy void returns reconciliation instead of success", async () => {
    const fixture = await createFixture("VOID-OVER", [3]);
    const sale = await checkout(auditId("VOID-OVER-SALE"), fixture);
    assert.equal(sale.status, 200);
    await simulatePartialVoid(sale.data.order.id, fixture, 0, 2, false);
    const before = await balances(fixture);
    const response = await voidOrder(sale.data.order.id, auditId("VOID-OVER"));
    assert.equal(response.status, 409, JSON.stringify(response.data));
    assert.equal(response.data.code, "POS_VOID_RECONCILIATION_REQUIRED");
    assert.equal(response.data.requiresManualReconciliation, true);
    assert.deepEqual(await balances(fixture), before);
    const { data: order } = await supabase.from("sales_orders").select("status, payment_status").eq("id", sale.data.order.id).single();
    assert.equal(order.status, "completed");
    assert.equal(order.payment_status, "paid");
  });

  for (const stage of ["stock_movements_void", "payments_void"]) {
    await runCase(`void ${stage} fault rolls inventory and status back`, async () => {
      const fixture = await createFixture(`VOID-FAULT-${stage}`, [2]);
      const sale = await checkout(auditId(`VOID-FAULT-SALE-${stage}`), fixture);
      assert.equal(sale.status, 200);
      const before = await balances(fixture);
      selectFault(stage, { orderId: sale.data.order.id });
      try {
        const response = await voidOrder(sale.data.order.id, auditId(`VOID-FAULT-${stage}`));
        assert.deepEqual(await balances(fixture), before);
        assert.equal((await movements(sale.data.order.id, "pos_void")).length, 0);
        const { data: order } = await supabase.from("sales_orders").select("status, payment_status").eq("id", sale.data.order.id).single();
        assert.equal(order.status, "completed");
        assert.equal(order.payment_status, "paid");
        assert.equal(response.status, 503, JSON.stringify(response.data));
      } finally {
        clearFault();
      }
    });
  }
} finally {
  await stopApp(server);
  try { uninstallFaultHarness(); } catch {}
  try { setCheckoutExecute(true); } catch {}
  try { await cleanupAuditData(); } catch {}
  if (config) await restoreConfig(config);
}

const failures = results.filter((result) => !result.ok);
console.log(`\nPOS integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) {
  console.error(`Failed cases: ${failures.map((failure) => failure.name).join(", ")}`);
  process.exitCode = 1;
}
