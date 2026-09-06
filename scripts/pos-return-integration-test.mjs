import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const APP_PORT = 3311;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const OWNER_PASSWORD = "AuditReturnOwner!2026-Alpha";
const STAFF_PASSWORD = "AuditReturnStaff!2026-Beta";
const PREFIX = "AUDIT-RETURN-";
const results = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8", stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"], input: options.input, env: { ...process.env, ...(options.env || {}) } });
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  return String(result.stdout || "").trim();
}
function sql(statement) { return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement }); }
function localEnvironment() {
  const output = process.platform === "win32" ? command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"]) : command("npx", ["supabase", "status", "-o", "env"]);
  const values = {}; for (const line of output.split(/\r?\n/)) { const match = line.match(/^([A-Z0-9_]+)="(.*)"$/); if (match) values[match[1]] = match[2]; }
  assert.equal(values.API_URL, "http://127.0.0.1:55321"); assert.ok(values.SERVICE_ROLE_KEY); return values;
}
const local = localEnvironment();
const supabase = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function runCase(name, callback) { try { await callback(); results.push({ name, ok: true }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, ok: false, error }); console.error(`FAIL ${name}\n${error?.stack || error}`); } }
function id(label) { return `${PREFIX}${label}-${randomUUID()}`; }
async function api(orderId, body, password = OWNER_PASSWORD) {
  const response = await fetch(`${APP_URL}/api/admin/pos/orders/${orderId}/returns`, { method: "POST", headers: { "content-type": "application/json", "x-admin-password": password }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function startApp(useRpc) {
  const logs = [];
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], { cwd: ROOT, env: { ...process.env, NEXT_PUBLIC_SITE_URL: APP_URL, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, ADMIN_PASSWORD: OWNER_PASSWORD, ADMIN_STAFF_PASSWORD: STAFF_PASSWORD, AUTH_RATE_LIMIT_SECRET: "test-only-return-auth-rate-limit-secret-2026", USE_POS_RPC: useRpc ? "true" : "false" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => logs.push(String(chunk))); child.stderr.on("data", chunk => logs.push(String(chunk)));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(`Next dev exited\n${logs.join("")}`); try { const response = await fetch(`${APP_URL}/admin`, { signal: AbortSignal.timeout(3000) }); if (response.status < 500) return { child, logs }; } catch {} await new Promise(resolve => setTimeout(resolve, 400)); }
  throw new Error(`Next dev timeout\n${logs.join("")}`);
}
async function stopApp(server) { if (!server?.child || server.child.exitCode !== null) return; if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" }); else server.child.kill("SIGTERM"); await new Promise(resolve => setTimeout(resolve, 400)); }

async function prepareFeature() {
  const { data, error } = await supabase.from("feature_settings").select("plan, features, updated_by").eq("id", 1).single(); if (error) throw error;
  const update = await supabase.from("feature_settings").update({ plan: "custom", features: { ...data.features, pos_checkout: true, pos_orders: true, pos_void: true, staff_accounts: true }, updated_by: "pos-return-test" }).eq("id", 1); if (update.error) throw update.error;
  return data;
}
async function fixture(label, stocks, prices = stocks.map(() => 10)) {
  const token = id(label).replace(/[^A-Z0-9-]/gi, "").toUpperCase();
  const { data: product, error: productError } = await supabase.from("products").insert({ sku: token, name_cn: token, name_en: token, name_gr: token, category: "audit", subcategory: "return", price: prices[0], stock: stocks.reduce((a, b) => a + b, 0), sizes: stocks.map((_, i) => `S${i + 1}`).join(","), size_stock: Object.fromEntries(stocks.map((quantity, i) => [`S${i + 1}`, quantity])), is_active: true }).select("id, sku").single(); if (productError) throw productError;
  const { data: location } = await supabase.from("inventory_locations").select("id").eq("code", "MAIN_STORE").single();
  const { data: variants, error: variantError } = await supabase.from("product_variants").insert(stocks.map((_, i) => ({ product_id: product.id, variant_sku: `${token}-S${i + 1}`, barcode: `${token}-B${i + 1}`, size: `S${i + 1}`, price: prices[i], active: true, sort_order: i }))).select("id, product_id, variant_sku, size, price"); if (variantError) throw variantError;
  const balances = await supabase.from("inventory_balances").insert(variants.map((variant, i) => ({ variant_id: variant.id, location_id: location.id, quantity_on_hand: stocks[i], quantity_reserved: 0 }))); if (balances.error) throw balances.error;
  return { product, variants, stocks };
}
async function checkout(f, quantities) {
  const request = id("SALE");
  const { data, error } = await supabase.rpc("pos_checkout_rpc", { p_client_request_id: request, p_payment_method: "cash", p_items: f.variants.map((variant, i) => ({ variantId: variant.id, quantity: quantities[i] || 0 })).filter(item => item.quantity > 0), p_discount_total: 0, p_notes: "return test", p_created_by: "test:owner", p_legal_terms_version: null, p_privacy_policy_version: null, p_legal_accepted_at: null });
  if (error) throw error; return data;
}
function body(requestId, orderItem, quantity, condition, exchangeItems = [], delta = -10, overrides = {}) {
  return { clientRequestId: requestId, returnItems: [{ orderItemId: orderItem.id, quantity, condition }], exchangeItems, reason: "顾客退换货测试", externalConfirmation: delta === 0 ? { confirmed: false, method: "", reference: "", expectedBalanceDelta: 0 } : { confirmed: true, method: "cash", reference: `${PREFIX}EXT-${randomUUID()}`, expectedBalanceDelta: delta }, ...overrides };
}
async function balance(variantId, code = "MAIN_STORE") {
  return Number(sql(`select coalesce((select b.quantity_on_hand from public.inventory_balances b join public.inventory_locations l on l.id=b.location_id where b.variant_id='${variantId}'::uuid and l.code='${code}'),0);`));
}
async function returnCount(requestId) { const { count, error } = await supabase.from("sales_returns").select("id", { count: "exact", head: true }).eq("client_request_id", requestId); if (error) throw error; return count; }
async function cleanup() {
  sql(`delete from public.audit_logs where action='pos_return_exchange_completed' and metadata->>'client_request_id' like '${PREFIX}%';
    delete from public.sales_exchange_items where exchange_id in (select e.id from public.sales_exchanges e join public.sales_returns r on r.id=e.return_id where r.client_request_id like '${PREFIX}%');
    delete from public.sales_return_items where return_id in (select id from public.sales_returns where client_request_id like '${PREFIX}%');
    delete from public.sales_exchanges where return_id in (select id from public.sales_returns where client_request_id like '${PREFIX}%');
    delete from public.sales_returns where client_request_id like '${PREFIX}%';
    delete from public.payments where order_id in (select id from public.sales_orders where idempotency_key like 'pos_sale:${PREFIX}%');
    delete from public.sales_order_items where order_id in (select id from public.sales_orders where idempotency_key like 'pos_sale:${PREFIX}%');
    delete from public.sales_orders where idempotency_key like 'pos_sale:${PREFIX}%';
    delete from public.stock_movements where variant_id in (select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%');
    delete from public.inventory_balances where variant_id in (select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%');
    delete from public.product_variants where product_id in (select id from public.products where sku like '${PREFIX}%'); delete from public.products where sku like '${PREFIX}%';`);
}

let feature; let server;
try {
  await cleanup(); feature = await prepareFeature(); fs.rmSync(path.join(ROOT, ".next", "cache"), { recursive: true, force: true });
  server = await startApp(false);
  await runCase("return fails closed when USE_POS_RPC is false", async () => { const f = await fixture("DISABLED", [2]); const sale = await checkout(f, [1]); const request = id("DISABLED"); const response = await api(sale.order.id, body(request, sale.items[0], 1, "resellable")); assert.equal(response.status, 503); assert.equal(await returnCount(request), 0); assert.equal(await balance(f.variants[0].id), 1); });
  await stopApp(server); server = await startApp(true);

  await runCase("same-price size exchange is atomic and idempotent", async () => { const f = await fixture("SAME", [2, 2], [10, 10]); const sale = await checkout(f, [1, 0]); const request = id("SAME"); const payload = body(request, sale.items[0], 1, "resellable", [{ variantId: f.variants[1].id, quantity: 1 }], 0); const first = await api(sale.order.id, payload); const replay = await api(sale.order.id, payload); assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(replay.status, 200); assert.equal(replay.data.alreadyProcessed, true); assert.equal(await returnCount(request), 1); assert.equal(await balance(f.variants[0].id), 2); assert.equal(await balance(f.variants[1].id), 1); assert.equal(first.data.return.balance_delta, 0); });

  await runCase("higher and lower exchanges require and persist exact external difference", async () => { const high = await fixture("HIGH", [2, 2], [10, 15]); const highSale = await checkout(high, [1, 0]); const highResult = await api(highSale.order.id, body(id("HIGH"), highSale.items[0], 1, "resellable", [{ variantId: high.variants[1].id, quantity: 1 }], 5)); assert.equal(highResult.status, 200, JSON.stringify(highResult.data)); assert.equal(Number(highResult.data.return.balance_delta), 5); assert.equal(highResult.data.return.external_action, "collection");
    const low = await fixture("LOW", [2, 2], [15, 10]); const lowSale = await checkout(low, [1, 0]); const lowResult = await api(lowSale.order.id, body(id("LOW"), lowSale.items[0], 1, "resellable", [{ variantId: low.variants[1].id, quantity: 1 }], -5)); assert.equal(lowResult.status, 200, JSON.stringify(lowResult.data)); assert.equal(Number(lowResult.data.return.balance_delta), -5); assert.equal(lowResult.data.return.external_action, "refund"); });

  await runCase("damaged and quarantine returns never increase sellable stock", async () => { const f = await fixture("HOLD", [2, 2]); const sale = await checkout(f, [1, 1]); const damagedItem = sale.items[0]; const quarantineItem = sale.items[1]; const damaged = await api(sale.order.id, body(id("DAMAGED"), damagedItem, 1, "damaged")); const quarantine = await api(sale.order.id, body(id("QUARANTINE"), quarantineItem, 1, "quarantine")); assert.equal(damaged.status, 200, JSON.stringify(damaged.data)); assert.equal(quarantine.status, 200, JSON.stringify(quarantine.data)); assert.equal(await balance(damagedItem.variant_id), 1, "damaged main balance"); assert.equal(await balance(quarantineItem.variant_id), 1, "quarantine main balance"); assert.equal(await balance(damagedItem.variant_id, "RETURNS_DAMAGED"), 1, "damaged holding balance"); assert.equal(await balance(quarantineItem.variant_id, "RETURNS_QUARANTINE"), 1, "quarantine holding balance"); });

  await runCase("different concurrent return IDs cannot return one sold unit twice", async () => { const f = await fixture("CONCURRENT", [2]); const sale = await checkout(f, [1]); const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => { const request = id(`CONCURRENT-${index}`); return api(sale.order.id, body(request, sale.items[0], 1, "resellable")); })); assert.equal(responses.filter(response => response.status === 200).length, 1); assert.equal(responses.filter(response => response.status === 409).length, 7); assert.equal(await balance(f.variants[0].id), 2); });

  await runCase("insufficient exchange stock rolls the complete return back", async () => { const f = await fixture("NO-STOCK", [2, 0], [10, 10]); const sale = await checkout(f, [1, 0]); const request = id("NO-STOCK"); const response = await api(sale.order.id, body(request, sale.items[0], 1, "resellable", [{ variantId: f.variants[1].id, quantity: 1 }], 0)); assert.equal(response.status, 409, JSON.stringify(response.data)); assert.equal(await returnCount(request), 0); assert.equal(await balance(f.variants[0].id), 1); assert.equal(await balance(f.variants[1].id), 0); });

  await runCase("external confirmation and staff permissions fail before writes", async () => { const f = await fixture("AUTH", [3]); const sale = await checkout(f, [1]); const missing = id("NO-CONFIRM"); const invalid = body(missing, sale.items[0], 1, "resellable"); invalid.externalConfirmation.confirmed = false; invalid.externalConfirmation.reference = ""; const rejected = await api(sale.order.id, invalid); assert.equal(rejected.status, 400); assert.equal(await returnCount(missing), 0); const staffId = id("STAFF"); const forbidden = await api(sale.order.id, body(staffId, sale.items[0], 1, "resellable"), STAFF_PASSWORD); assert.equal(forbidden.status, 403); assert.equal(await returnCount(staffId), 0); });

  await runCase("fault after inventory changes rolls every table back", async () => { const f = await fixture("FAULT", [2, 2]); const sale = await checkout(f, [1, 0]); const request = id("FAULT"); sql(`create schema if not exists audit_return_test; create or replace function audit_return_test.fail_exchange_item() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_RETURN_FAULT'; end $$; create trigger audit_return_fail before insert on public.sales_exchange_items for each row execute function audit_return_test.fail_exchange_item();`); try { const response = await api(sale.order.id, body(request, sale.items[0], 1, "resellable", [{ variantId: f.variants[1].id, quantity: 1 }], 0)); assert.equal(response.status, 503); assert.equal(await returnCount(request), 0); assert.equal(await balance(f.variants[0].id), 1); assert.equal(await balance(f.variants[1].id), 2); } finally { sql("drop trigger if exists audit_return_fail on public.sales_exchange_items; drop schema if exists audit_return_test cascade;"); } });
} finally {
  await stopApp(server); try { sql("drop trigger if exists audit_return_fail on public.sales_exchange_items; drop schema if exists audit_return_test cascade;"); } catch {}
  try { await cleanup(); } catch {} if (feature) await supabase.from("feature_settings").update(feature).eq("id", 1);
}
const failures = results.filter(result => !result.ok); console.log(`\nPOS return integration: ${results.length - failures.length}/${results.length} passed.`); if (failures.length) process.exitCode = 1;
