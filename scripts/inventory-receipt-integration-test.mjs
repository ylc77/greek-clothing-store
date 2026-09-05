import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const PREFIX = "AUDIT-RCV-";

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8", input: options.input, stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  return String(result.stdout || "").trim();
}
function sql(statement) {
  return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement });
}
function environment() {
  const output = process.platform === "win32"
    ? command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"])
    : command("npx", ["supabase", "status", "-o", "env"]);
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  assert.equal(values.API_URL, "http://127.0.0.1:55321");
  return values;
}
const local = environment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function cleanup() {
  sql(`
    delete from public.inventory_receipt_items where receipt_id in (select id from public.inventory_receipts where client_request_id like '${PREFIX}%');
    delete from public.inventory_receipts where client_request_id like '${PREFIX}%';
    delete from public.stock_movements where source_type='inventory_receipt' and idempotency_key like 'inventory-receipt:${PREFIX}%';
    delete from public.inventory_balances where variant_id in (select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku like '${PREFIX}%');
    delete from public.product_variants where product_id in (select id from public.products where sku like '${PREFIX}%');
    delete from public.products where sku like '${PREFIX}%';
  `);
}

async function fixture(label) {
  const token = `${PREFIX}${label}-${randomUUID()}`.toUpperCase();
  const { data: product, error: productError } = await service.from("products").insert({
    sku: token, name_cn: token, name_en: token, name_gr: token, category: "audit", subcategory: "receiving",
    price: 20, stock: 3, sizes: "S,M", size_stock: { S: 1, M: 2 }, is_active: true,
  }).select("id,sku").single();
  if (productError) throw productError;
  const { data: variants, error: variantError } = await service.from("product_variants").insert([
    { product_id: product.id, variant_sku: `${token}-S`, barcode: null, size: "S", active: true, sort_order: 0 },
    { product_id: product.id, variant_sku: `${token}-M`, barcode: `${token}-M`, size: "M", active: true, sort_order: 1 },
  ]).select("id,variant_sku,barcode");
  if (variantError) throw variantError;
  const { data: location, error: locationError } = await service.from("inventory_locations").select("id").eq("code", "MAIN_STORE").single();
  if (locationError) throw locationError;
  const { error: balanceError } = await service.from("inventory_balances").insert([
    { variant_id: variants[0].id, location_id: location.id, quantity_on_hand: 1, quantity_reserved: 0 },
    { variant_id: variants[1].id, location_id: location.id, quantity_on_hand: 2, quantity_reserved: 0 },
  ]);
  if (balanceError) throw balanceError;
  return { product, variants, location };
}

async function complete(f, requestId, items = null) {
  return service.rpc("inventory_receipt_complete_rpc", {
    p_client_request_id: requestId,
    p_supplier_id: null,
    p_supplier_reference: "DELIVERY-1",
    p_notes: "Integration receipt",
    p_items: items || [
      { variantId: f.variants[0].id, quantity: 2, unitCost: 5 },
      { variantId: f.variants[1].id, quantity: 3, unitCost: 6 },
    ],
    p_created_by: "test:owner",
  });
}

await cleanup();
try {
  const denied = await anon.rpc("inventory_receipt_complete_rpc", { p_client_request_id: "x", p_supplier_id: null, p_supplier_reference: null, p_notes: null, p_items: [], p_created_by: "x" });
  assert.equal(denied.error?.code, "42501");
  console.log("PASS public roles cannot execute receipt RPC");

  const f = await fixture("SUCCESS");
  const requestId = `${PREFIX}SUCCESS-${randomUUID()}`;
  const first = await complete(f, requestId);
  if (first.error) throw first.error;
  assert.equal(first.data.totalUnits, 5);
  assert.equal(first.data.items.length, 2);
  assert.equal(first.data.items.find(item => item.variantId === f.variants[0].id).barcode, f.variants[0].variant_sku);
  const balances = await service.from("inventory_balances").select("variant_id,quantity_on_hand").in("variant_id", f.variants.map(v => v.id));
  if (balances.error) throw balances.error;
  assert.deepEqual(new Map(balances.data.map(row => [row.variant_id, row.quantity_on_hand])), new Map([[f.variants[0].id, 3], [f.variants[1].id, 5]]));
  const product = await service.from("products").select("stock,size_stock").eq("id", f.product.id).single();
  if (product.error) throw product.error;
  assert.equal(product.data.stock, 8);
  assert.deepEqual(product.data.size_stock, { S: 3, M: 5 });
  console.log("PASS multi-Variant receipt, missing Barcode, movements, and projections commit together");

  const replay = await complete(f, requestId);
  if (replay.error) throw replay.error;
  assert.equal(replay.data.alreadyProcessed, true);
  assert.equal(sql(`select count(*) from public.inventory_receipts where client_request_id='${requestId}';`), "1");
  assert.equal(sql(`select count(*) from public.stock_movements where source_id='${first.data.receiptId}';`), "2");
  console.log("PASS same request ID replay is idempotent");

  const conflict = await complete(f, requestId, [{ variantId: f.variants[0].id, quantity: 9, unitCost: 5 }]);
  assert.ok(conflict.error?.message.includes("INVENTORY_RECEIPT_CONFLICT"));
  console.log("PASS changed replay payload conflicts");

  const rollback = await fixture("ROLLBACK");
  const invalid = await complete(rollback, `${PREFIX}ROLLBACK-${randomUUID()}`, [
    { variantId: rollback.variants[0].id, quantity: 4, unitCost: null },
    { variantId: randomUUID(), quantity: 1, unitCost: null },
  ]);
  assert.ok(invalid.error?.message.includes("INVENTORY_RECEIPT_VARIANT_NOT_FOUND"));
  assert.equal(sql(`select quantity_on_hand from public.inventory_balances where variant_id='${rollback.variants[0].id}';`), "1");
  assert.equal(sql(`select barcode is null from public.product_variants where id='${rollback.variants[0].id}';`), "t");
  console.log("PASS invalid item rolls back every Variant and generated Barcode");

  const barcodeConflict = await fixture("BARCODE-CONFLICT");
  const blockerSku = `${PREFIX}BARCODE-BLOCKER-${randomUUID()}`.toUpperCase();
  const { data: blockerProduct, error: blockerProductError } = await service.from("products").insert({
    sku: blockerSku, name_cn: blockerSku, name_en: blockerSku, name_gr: blockerSku,
    category: "audit", subcategory: "receiving", price: 10, stock: 0,
    sizes: "ONE SIZE", size_stock: { "ONE SIZE": 0 }, is_active: true,
  }).select("id").single();
  if (blockerProductError) throw blockerProductError;
  const { error: blockerVariantError } = await service.from("product_variants").insert({
    product_id: blockerProduct.id,
    variant_sku: `${blockerSku}-ONE`,
    barcode: barcodeConflict.variants[0].variant_sku,
    size: "ONE SIZE",
    active: true,
  });
  if (blockerVariantError) throw blockerVariantError;
  const barcodeConflictRequestId = `${PREFIX}BARCODE-CONFLICT-${randomUUID()}`;
  const barcodeCollision = await complete(barcodeConflict, barcodeConflictRequestId, [
    { variantId: barcodeConflict.variants[0].id, quantity: 2, unitCost: null },
  ]);
  assert.ok(barcodeCollision.error?.message.includes("INVENTORY_RECEIPT_BARCODE_CONFLICT"));
  assert.equal(sql(`select quantity_on_hand from public.inventory_balances where variant_id='${barcodeConflict.variants[0].id}';`), "1");
  assert.equal(sql(`select barcode is null from public.product_variants where id='${barcodeConflict.variants[0].id}';`), "t");
  assert.equal(sql(`select count(*) from public.inventory_receipts where client_request_id='${barcodeConflictRequestId}';`), "0");
  console.log("PASS generated Barcode conflict returns a clear error and rolls back the receipt");

  const concurrent = await fixture("CONCURRENT");
  const [left, right] = await Promise.all([
    complete(concurrent, `${PREFIX}CONCURRENT-A-${randomUUID()}`, [{ variantId: concurrent.variants[0].id, quantity: 2, unitCost: null }]),
    complete(concurrent, `${PREFIX}CONCURRENT-B-${randomUUID()}`, [{ variantId: concurrent.variants[0].id, quantity: 3, unitCost: null }]),
  ]);
  if (left.error) throw left.error;
  if (right.error) throw right.error;
  assert.equal(sql(`select quantity_on_hand from public.inventory_balances where variant_id='${concurrent.variants[0].id}';`), "6");
  assert.equal(sql(`select count(*) from public.stock_movements where variant_id='${concurrent.variants[0].id}' and source_type='inventory_receipt';`), "2");
  console.log("PASS concurrent receipts serialize without lost updates");

  sql(`
    create schema if not exists audit_receipt_test;
    create or replace function audit_receipt_test.fail_item() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_RECEIPT_FAULT'; end $$;
    create trigger audit_receipt_fail before insert on public.inventory_receipt_items for each row execute function audit_receipt_test.fail_item();
  `);
  const fault = await fixture("FAULT");
  const failed = await complete(fault, `${PREFIX}FAULT-${randomUUID()}`, [{ variantId: fault.variants[0].id, quantity: 7, unitCost: null }]);
  assert.ok(failed.error);
  sql("drop trigger audit_receipt_fail on public.inventory_receipt_items; drop schema audit_receipt_test cascade;");
  assert.equal(sql(`select quantity_on_hand from public.inventory_balances where variant_id='${fault.variants[0].id}';`), "1");
  assert.equal(sql(`select barcode is null from public.product_variants where id='${fault.variants[0].id}';`), "t");
  console.log("PASS injected item failure rolls back receipt, Barcode, balance, movement, and projection");
} finally {
  try { sql("drop trigger if exists audit_receipt_fail on public.inventory_receipt_items; drop schema if exists audit_receipt_test cascade;"); } catch {}
  await cleanup();
}

assert.equal(sql(`select count(*) from public.inventory_receipts where client_request_id like '${PREFIX}%';`), "0");
assert.equal(sql(`select count(*) from public.products where sku like '${PREFIX}%';`), "0");
console.log("PASS receipt integration cleanup");
