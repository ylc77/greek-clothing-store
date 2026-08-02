import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const PREFIX = "AUDIT-WEB-";

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement });
}

function localEnvironment() {
  const output = process.platform === "win32"
    ? command(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npx.cmd supabase status -o env"])
    : command("npx", ["supabase", "status", "-o", "env"]);
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  values.API_URL ||= `http://127.0.0.1:${API_PORT}`;
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`);
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`));
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

const local = localEnvironment();
const supabase = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function cleanup() {
  sql(`
    delete from public.online_order_operations where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.stock_movements where source_type = 'online_order' and source_id in (select id::text from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_order_items where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_orders where customer_email like 'audit-web-%@example.com';
    delete from public.stock_movements where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%'
    );
    delete from public.inventory_balances where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%'
    );
    delete from public.product_variants where product_id in (select id from public.products where sku like '${PREFIX}%');
    delete from public.products where sku like '${PREFIX}%';
  `);
}

async function fixture() {
  const sku = `${PREFIX}${randomUUID()}`.toUpperCase();
  const { data: product, error: productError } = await supabase.from("products").insert({
    sku,
    name_cn: "在线订单测试商品",
    name_en: "Online order audit product",
    name_gr: "Δοκιμαστικό προϊόν online παραγγελίας",
    category: "audit",
    subcategory: "orders",
    price: 30,
    stock: 6,
    sizes: "M,L",
    size_stock: { M: 5, L: 1 },
    is_active: true,
  }).select("id,sku").single();
  if (productError) throw productError;
  const { data: location, error: locationError } = await supabase.from("inventory_locations").select("id").eq("code", "MAIN_STORE").single();
  if (locationError) throw locationError;
  const { data: variants, error: variantsError } = await supabase.from("product_variants").insert([
    { product_id: product.id, variant_sku: `${sku}-M-GREEN`, size: "M", color: "Green", price: 30, active: true },
    { product_id: product.id, variant_sku: `${sku}-L-GREEN`, size: "L", color: "Green", price: 32, active: true },
  ]).select("id,size");
  if (variantsError) throw variantsError;
  const bySize = Object.fromEntries(variants.map(row => [row.size, row]));
  const { error: balancesError } = await supabase.from("inventory_balances").insert([
    { variant_id: bySize.M.id, location_id: location.id, quantity_on_hand: 5, quantity_reserved: 0 },
    { variant_id: bySize.L.id, location_id: location.id, quantity_on_hand: 1, quantity_reserved: 0 },
  ]);
  if (balancesError) throw balancesError;
  return { product, variants: bySize, location };
}

function createArgs(f, { operationId = randomUUID(), size = "M", quantity = 1, fulfillment = "pickup", fingerprint, token } = {}) {
  const accessToken = token || randomBytes(32).toString("base64url");
  const requestFingerprint = fingerprint || createHash("sha256").update(`${f.product.sku}:${size}:${quantity}:${fulfillment}`).digest("hex");
  return {
    operationId,
    args: {
      p_operation_id: operationId,
      p_request_fingerprint: requestFingerprint,
      p_access_token_hash: createHash("sha256").update(accessToken).digest("hex"),
      p_customer: { name: "Audit Customer", email: `audit-web-${operationId}@example.com`, phone: "+306900000000", addressLine1: fulfillment === "delivery" ? "1 Audit Street" : "", city: fulfillment === "delivery" ? "Athens" : "", postalCode: fulfillment === "delivery" ? "10558" : "", notes: "" },
      p_items: [{ productSku: f.product.sku, size, color: "Green", quantity }],
      p_fulfillment_method: fulfillment,
      p_payment_method: fulfillment === "delivery" ? "cash_on_delivery" : "pay_at_pickup",
      p_shipping_fee: 4,
      p_free_shipping_threshold: 60,
      p_locale: "en",
      p_legal_terms_version: "audit-v1",
      p_privacy_policy_version: "audit-v1",
      p_legal_accepted_at: new Date().toISOString(),
    },
  };
}

async function createOrder(input) {
  return supabase.rpc("online_order_create_rpc", input.args);
}

async function transition(orderId, target, operationId = randomUUID()) {
  return supabase.rpc("online_order_transition_rpc", { p_order_id: orderId, p_target_status: target, p_operation_id: operationId, p_actor: "integration-test" });
}

async function balance(variantId) {
  const { data, error } = await supabase.from("inventory_balances").select("quantity_on_hand,quantity_reserved").eq("variant_id", variantId).single();
  if (error) throw error;
  return data;
}

cleanup();
try {
  const f = await fixture();

  const initial = createArgs(f, { size: "M", quantity: 2 });
  const first = await createOrder(initial);
  assert.ifError(first.error);
  assert.equal(first.data.replayed, false);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 5, quantity_reserved: 2 });

  const replay = await createOrder(initial);
  assert.ifError(replay.error);
  assert.equal(replay.data.id, first.data.id);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 5, quantity_reserved: 2 });

  const conflict = await createOrder({ ...initial, args: { ...initial.args, p_request_fingerprint: "different-fingerprint" } });
  assert.ok(conflict.error);
  assert.match(conflict.error.message, /ONLINE_ORDER_IDEMPOTENCY_CONFLICT/);

  for (const status of ["confirmed", "ready_for_pickup", "completed"]) {
    const result = await transition(first.data.id, status);
    assert.ifError(result.error);
    assert.equal(result.data.status, status);
  }
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 0 });

  const cancelInput = createArgs(f, { size: "M", quantity: 1 });
  const cancelOrder = await createOrder(cancelInput);
  assert.ifError(cancelOrder.error);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 1 });
  const cancelOperation = randomUUID();
  const cancelled = await transition(cancelOrder.data.id, "cancelled", cancelOperation);
  assert.ifError(cancelled.error);
  const cancelReplay = await transition(cancelOrder.data.id, "cancelled", cancelOperation);
  assert.ifError(cancelReplay.error);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 0 });

  const concurrentA = createArgs(f, { size: "L", quantity: 1, fulfillment: "delivery" });
  const concurrentB = createArgs(f, { size: "L", quantity: 1, fulfillment: "delivery" });
  const concurrent = await Promise.all([createOrder(concurrentA), createOrder(concurrentB)]);
  assert.equal(concurrent.filter(row => !row.error).length, 1);
  assert.equal(concurrent.filter(row => row.error && /ONLINE_ORDER_INSUFFICIENT_STOCK/.test(row.error.message)).length, 1);
  assert.deepEqual(await balance(f.variants.L.id), { quantity_on_hand: 1, quantity_reserved: 1 });
  const winner = concurrent.find(row => !row.error);
  assert.ok(winner);
  assert.ifError((await transition(winner.data.id, "cancelled")).error);
  assert.deepEqual(await balance(f.variants.L.id), { quantity_on_hand: 1, quantity_reserved: 0 });

  const { count: orderCount, error: countError } = await supabase.from("online_orders").select("id", { count: "exact", head: true }).like("customer_email", "audit-web-%@example.com");
  assert.ifError(countError);
  assert.equal(orderCount, 3);
  console.log("PASS online order integration: idempotency, reservation, cancellation, completion and last-unit concurrency");
} finally {
  cleanup();
  const leftovers = Number(sql(`select count(*) from public.online_orders where customer_email like 'audit-web-%@example.com';`));
  assert.equal(leftovers, 0, "online order integration test data must be fully removed");
}
