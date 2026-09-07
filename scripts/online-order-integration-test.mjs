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
  const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8", stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"], input: options.input });
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement });
}

function assertDatabaseBoundary() {
  sql(`
    do $$
    declare candidate record;
    declare table_name text;
    begin
      for candidate in
        select p.oid, p.oid::regprocedure as signature, p.proconfig
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
          'product_fulfillment_update_rpc', 'online_checkout_prepare_rpc',
          'online_checkout_bind_viva_rpc', 'online_payment_confirm_rpc',
          'online_shipment_prepare_rpc', 'online_shipment_complete_rpc',
          'online_shipment_cancel_prepare_rpc', 'online_shipment_cancel_complete_rpc',
          'online_shipment_refresh_rpc', 'online_order_transition_rpc',
          'online_order_extend_pickup_rpc', 'online_order_expire_pending_rpc',
          'product_checkout_variants_batch_rpc', 'online_commerce_runtime_health_rpc'
        )
      loop
        if pg_catalog.has_function_privilege('anon',candidate.oid,'execute')
           or pg_catalog.has_function_privilege('authenticated',candidate.oid,'execute')
           or not pg_catalog.has_function_privilege('service_role',candidate.oid,'execute') then
          raise exception 'unsafe execute grant for %',candidate.signature;
        end if;
        if not candidate.proconfig @> array['search_path=""'] then
          raise exception 'unsafe search_path for %',candidate.signature;
        end if;
      end loop;
      if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in (
            'product_fulfillment_update_rpc','online_checkout_prepare_rpc','online_checkout_bind_viva_rpc',
            'online_payment_confirm_rpc','online_shipment_prepare_rpc','online_shipment_complete_rpc',
            'online_shipment_cancel_prepare_rpc','online_shipment_cancel_complete_rpc','online_shipment_refresh_rpc',
            'online_order_transition_rpc','online_order_extend_pickup_rpc','online_order_expire_pending_rpc',
            'product_checkout_variants_batch_rpc','online_commerce_runtime_health_rpc'
          )) <> 14 then raise exception 'online commerce RPC set is incomplete'; end if;
      foreach table_name in array array['online_payment_attempts','online_payment_events','online_shipments','product_fulfillment_operations']
      loop
        if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=table_name and c.relrowsecurity) then
          raise exception 'RLS missing for %',table_name;
        end if;
        if pg_catalog.has_table_privilege('anon','public.'||table_name,'select,insert,update,delete')
           or pg_catalog.has_table_privilege('authenticated','public.'||table_name,'select,insert,update,delete') then
          raise exception 'public table privilege present for %',table_name;
        end if;
      end loop;
      if (public.online_commerce_runtime_health_rpc()->>'ready')::boolean is not true then
        raise exception 'online commerce runtime is not ready';
      end if;
    end;
    $$;
  `);
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
    delete from public.online_payment_events where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_shipments where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_payment_attempts where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_order_operations where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.stock_movements where source_type='online_order' and source_id in (select id::text from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_order_items where order_id in (select id from public.online_orders where customer_email like 'audit-web-%@example.com');
    delete from public.online_orders where customer_email like 'audit-web-%@example.com';
    delete from public.product_fulfillment_operations where product_id in (select id from public.products where sku like '${PREFIX}%');
    delete from public.stock_movements where variant_id in (select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%');
    delete from public.inventory_balances where variant_id in (select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%');
    delete from public.product_variants where product_id in (select id from public.products where sku like '${PREFIX}%');
    delete from public.products where sku like '${PREFIX}%';
  `);
}

async function fixture() {
  const sku = `${PREFIX}${randomUUID()}`.toUpperCase();
  const { data: product, error: productError } = await supabase.from("products").insert({
    sku, name_cn: "在线订单测试商品", name_en: "Online order audit product", name_gr: "Δοκιμαστικό προϊόν online παραγγελίας",
    category: "audit", subcategory: "orders", price: 30, stock: 6, sizes: "M,L", size_stock: { M: 5, L: 1 },
    is_active: true, fulfillment_profile: "boxnow_and_pickup",
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
  return { product, variants: bySize };
}

function checkoutArgs(f, { operationId = randomUUID(), size = "M", quantity = 1, fulfillment = "store_pickup", fingerprint, token } = {}) {
  const accessToken = token || randomBytes(32).toString("base64url");
  const requestFingerprint = fingerprint || createHash("sha256").update(`${f.product.sku}:${size}:${quantity}:${fulfillment}`).digest("hex");
  return {
    operationId, requestFingerprint,
    args: {
      p_operation_id: operationId, p_request_fingerprint: requestFingerprint,
      p_access_token_hash: createHash("sha256").update(accessToken).digest("hex"),
      p_customer: { name: "Audit Customer", email: `audit-web-${operationId}@example.com`, phone: "+306900000000", notes: "" },
      p_items: [{ productSku: f.product.sku, size, color: "Green", quantity }],
      p_fulfillment_method: fulfillment,
      p_locker: fulfillment === "box_now" ? { id: "AUDIT-LOCKER", name: "Audit Locker", address: "1 Audit Street", postalCode: "10558" } : {},
      p_boxnow_enabled: true, p_pickup_enabled: true, p_boxnow_minimum_subtotal: 15,
      p_boxnow_shipping_fee: 2.5, p_boxnow_free_shipping_threshold: 39, p_boxnow_max_items: 10,
      p_locale: "en", p_legal_terms_version: "audit-v1", p_privacy_policy_version: "audit-v1",
      p_legal_accepted_at: new Date().toISOString(),
    },
  };
}

async function prepare(input) { return supabase.rpc("online_checkout_prepare_rpc", input.args); }
async function transition(orderId, target, operationId = randomUUID()) {
  return supabase.rpc("online_order_transition_rpc", { p_order_id: orderId, p_target_status: target, p_operation_id: operationId, p_actor: "integration-test", p_note: "integration test" });
}
async function markPaid(input, order) {
  const orderCode = String(BigInt(`9${Date.now()}${Math.floor(Math.random() * 100000)}`));
  const transactionId = randomUUID();
  const bound = await supabase.rpc("online_checkout_bind_viva_rpc", {
    p_operation_id: input.operationId, p_request_fingerprint: input.requestFingerprint, p_order_id: order.id,
    p_viva_order_code: orderCode, p_payment_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  assert.ifError(bound.error);
  const confirmed = await supabase.rpc("online_payment_confirm_rpc", {
    p_provider_event_id: randomUUID(), p_event_type: "1796", p_provider_order_code: orderCode,
    p_provider_transaction_id: transactionId, p_amount_cents: order.amountCents, p_currency: "EUR",
    p_payload_digest: createHash("sha256").update(transactionId).digest("hex"), p_confirmed_success: true,
  });
  assert.ifError(confirmed.error);
}
async function balance(variantId) {
  const { data, error } = await supabase.from("inventory_balances").select("quantity_on_hand,quantity_reserved").eq("variant_id", variantId).single();
  if (error) throw error;
  return data;
}

assertDatabaseBoundary();
cleanup();
try {
  const f = await fixture();
  const initial = checkoutArgs(f, { size: "M", quantity: 2 });
  const first = await prepare(initial);
  assert.ifError(first.error);
  assert.equal(first.data.replayed, false);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 5, quantity_reserved: 2 });

  const replay = await prepare(initial);
  assert.ifError(replay.error);
  assert.equal(replay.data.id, first.data.id);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 5, quantity_reserved: 2 });

  const conflict = await prepare({ ...initial, args: { ...initial.args, p_request_fingerprint: "different-fingerprint" } });
  assert.ok(conflict.error);
  assert.match(conflict.error.message, /ONLINE_ORDER_IDEMPOTENCY_CONFLICT/);

  await markPaid(initial, first.data);
  for (const status of ["packing", "ready_for_pickup", "completed"]) {
    const result = await transition(first.data.id, status);
    assert.ifError(result.error);
    assert.equal(result.data.status, status);
  }
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 0 });

  const cancelInput = checkoutArgs(f, { size: "M", quantity: 1 });
  const cancelOrder = await prepare(cancelInput);
  assert.ifError(cancelOrder.error);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 1 });
  const cancelOperation = randomUUID();
  assert.ifError((await transition(cancelOrder.data.id, "cancelled", cancelOperation)).error);
  assert.ifError((await transition(cancelOrder.data.id, "cancelled", cancelOperation)).error);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 0 });

  const expiryInput = checkoutArgs(f, { size: "M", quantity: 1 });
  const expiryOrder = await prepare(expiryInput);
  assert.ifError(expiryOrder.error);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 1 });
  const expiryBound = await supabase.rpc("online_checkout_bind_viva_rpc", {
    p_operation_id: expiryInput.operationId,
    p_request_fingerprint: expiryInput.requestFingerprint,
    p_order_id: expiryOrder.data.id,
    p_viva_order_code: `8${Date.now()}${Math.floor(Math.random() * 100000)}`,
    p_payment_expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.ifError(expiryBound.error);
  const expired = await supabase.rpc("online_order_expire_pending_rpc", { p_limit: 100 });
  assert.ifError(expired.error);
  assert.equal(expired.data.expired, 1);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 0 });

  const { error: oversizedUpdateError } = await supabase.from("products").update({
    package_weight_grams: 20001,
    package_length_mm: 400,
    package_width_mm: 300,
    package_height_mm: 200,
  }).eq("id", f.product.id);
  assert.ifError(oversizedUpdateError);
  const oversized = await prepare(checkoutArgs(f, { size: "M", quantity: 1, fulfillment: "box_now" }));
  assert.ok(oversized.error);
  assert.match(oversized.error.message, /ONLINE_ORDER_PACKAGE_LIMIT/);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 3, quantity_reserved: 0 });
  const { error: safePackageUpdateError } = await supabase.from("products").update({
    package_weight_grams: 500,
    package_length_mm: 400,
    package_width_mm: 300,
    package_height_mm: 200,
  }).eq("id", f.product.id);
  assert.ifError(safePackageUpdateError);

  const concurrent = await Promise.all([
    prepare(checkoutArgs(f, { size: "L", quantity: 1, fulfillment: "box_now" })),
    prepare(checkoutArgs(f, { size: "L", quantity: 1, fulfillment: "box_now" })),
  ]);
  assert.equal(concurrent.filter(row => !row.error).length, 1);
  assert.equal(concurrent.filter(row => row.error && /ONLINE_ORDER_INSUFFICIENT_STOCK/.test(row.error.message)).length, 1);
  assert.deepEqual(await balance(f.variants.L.id), { quantity_on_hand: 1, quantity_reserved: 1 });
  const winner = concurrent.find(row => !row.error);
  assert.ok(winner);
  assert.ifError((await transition(winner.data.id, "cancelled")).error);
  assert.deepEqual(await balance(f.variants.L.id), { quantity_on_hand: 1, quantity_reserved: 0 });

  const boxInput = checkoutArgs(f, { size: "M", quantity: 1, fulfillment: "box_now" });
  const boxOrder = await prepare(boxInput);
  assert.ifError(boxOrder.error);
  await markPaid(boxInput, boxOrder.data);
  assert.ifError((await transition(boxOrder.data.id, "packing")).error);
  const shipmentOperation = randomUUID();
  const shipmentFingerprint = createHash("sha256").update(boxOrder.data.id).digest("hex");
  const shipmentPrepared = await supabase.rpc("online_shipment_prepare_rpc", {
    p_order_id: boxOrder.data.id, p_operation_id: shipmentOperation, p_request_fingerprint: shipmentFingerprint, p_actor: "integration-test",
  });
  assert.ifError(shipmentPrepared.error);
  const shipmentCompleted = await supabase.rpc("online_shipment_complete_rpc", {
    p_shipment_id: shipmentPrepared.data.shipmentId, p_operation_id: shipmentOperation,
    p_reference_number: `AUDIT-REF-${Date.now()}`, p_parcel_id: `AUDIT-PARCEL-${randomUUID()}`,
    p_failure_code: null, p_outcome_unknown: false,
  });
  assert.ifError(shipmentCompleted.error);
  const refreshedNew = await supabase.rpc("online_shipment_refresh_rpc", {
    p_order_id: boxOrder.data.id, p_operation_id: randomUUID(), p_actor: "integration-test", p_provider_state: "new", p_note: "integration refresh",
  });
  assert.ifError(refreshedNew.error);
  assert.equal(refreshedNew.data.status, "ready_for_handover");
  assert.ifError((await transition(boxOrder.data.id, "shipped")).error);
  const refreshedDelivered = await supabase.rpc("online_shipment_refresh_rpc", {
    p_order_id: boxOrder.data.id, p_operation_id: randomUUID(), p_actor: "integration-test", p_provider_state: "delivered", p_note: "integration delivered",
  });
  assert.ifError(refreshedDelivered.error);
  assert.equal(refreshedDelivered.data.status, "delivered");
  assert.ifError((await transition(boxOrder.data.id, "completed")).error);
  assert.deepEqual(await balance(f.variants.M.id), { quantity_on_hand: 2, quantity_reserved: 0 });

  const { count: orderCount, error: countError } = await supabase.from("online_orders").select("id", { count: "exact", head: true }).like("customer_email", "audit-web-%@example.com");
  assert.ifError(countError);
  assert.equal(orderCount, 5);
  console.log("PASS online checkout integration: Viva binding, payment confirmation, idempotency, reservation, cancellation, completion, BOX NOW package limits, state refresh and last-unit concurrency");
} finally {
  cleanup();
  assert.equal(Number(sql(`select count(*) from public.online_orders where customer_email like 'audit-web-%@example.com';`)), 0, "online checkout integration data must be fully removed");
}
