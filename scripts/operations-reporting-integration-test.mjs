import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const TOKEN = `AUDIT-OPS-${randomUUID().replaceAll("-", "").toUpperCase()}`;
const ACTOR_ID = randomUUID();
const ACTOR = `account:owner:${ACTOR_ID}`;

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) {
    if (options.sensitiveOutput) throw new Error(`${name} failed; sensitive output suppressed`);
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`);
  }
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-q", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement });
}

function sqlFails(statement, marker) {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: statement,
  });
  assert.notEqual(result.status, 0, "SQL unexpectedly succeeded");
  assert.match(`${result.stdout || ""}\n${result.stderr || ""}`, marker);
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
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

const local = readLocalEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function rpc(name, args) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data;
}

async function barcode(requestId, assignments, mode = "explicit", actor = ACTOR) {
  return service.rpc("variant_barcodes_apply_rpc", {
    p_client_request_id: requestId,
    p_assignments: assignments,
    p_mode: mode,
    p_actor: actor,
  });
}

function cleanup() {
  sql(`
    delete from public.audit_logs where actor = '${ACTOR}';
    delete from public.barcode_operations where actor = '${ACTOR}';
    delete from public.payments where order_id in (select id from public.sales_orders where order_number like '${TOKEN}%');
    delete from public.stock_movements where source_id like '${TOKEN}%' or variant_id in (
      select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku='${TOKEN}'
    );
    delete from public.sales_order_items where order_id in (select id from public.sales_orders where order_number like '${TOKEN}%');
    delete from public.sales_orders where order_number like '${TOKEN}%';
    delete from public.inventory_balances where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id=v.product_id where p.sku='${TOKEN}'
    );
    delete from public.product_variants where product_id in (select id from public.products where sku='${TOKEN}');
    delete from public.products where sku='${TOKEN}';
  `);
}

async function main() {
  cleanup();
  try {
    const winter = await rpc("pos_day_bounds_rpc", { p_business_date: "2026-01-15" });
    assert.equal(winter.timezone, "Europe/Athens");
    assert.equal(winter.start, "2026-01-14T22:00:00+00:00");
    assert.equal(winter.end, "2026-01-15T22:00:00+00:00");
    const spring = await rpc("pos_day_bounds_rpc", { p_business_date: "2026-03-29" });
    assert.equal(spring.start, "2026-03-28T22:00:00+00:00");
    assert.equal(spring.end, "2026-03-29T21:00:00+00:00");
    const autumn = await rpc("pos_day_bounds_rpc", { p_business_date: "2026-10-25" });
    assert.equal(autumn.start, "2026-10-24T21:00:00+00:00");
    assert.equal(autumn.end, "2026-10-25T22:00:00+00:00");
    console.log("PASS Europe/Athens winter, summer and DST day bounds");

    const productId = Number(sql(`insert into public.products(sku,name_cn,name_en,name_gr,category,subcategory,price,stock,sizes,size_stock,is_active) values('${TOKEN}','Operations audit','Operations audit','Operations audit','audit','operations',10,2000,'S','{"S":2000}'::jsonb,true) returning id;`));
    const variants = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    sql(`
      insert into public.product_variants(id,product_id,variant_sku,size,price,active,sort_order) values
      ('${variants[0]}',${productId},'${TOKEN}-S','S',10,true,0),
      ('${variants[1]}',${productId},'${TOKEN}-M','M',10,true,1),
      ('${variants[2]}',${productId},'${TOKEN}-L','L',10,true,2),
      ('${variants[3]}',${productId},'${TOKEN}-XL','XL',10,true,3);
      insert into public.inventory_balances(variant_id,location_id,quantity_on_hand,quantity_reserved)
      select v.id,l.id,2000,0 from public.product_variants v cross join public.inventory_locations l
      where v.product_id=${productId} and l.code='MAIN_STORE';
    `);

    sql(`
      with inserted as (
        insert into public.sales_orders(id,order_number,status,source,subtotal,discount_total,total,currency,payment_status,idempotency_key,created_by,created_at,completed_at)
        select pg_catalog.gen_random_uuid(), '${TOKEN}-' || pg_catalog.lpad(n::text,4,'0'), 'completed','pos',10,0,10,'EUR','paid','${TOKEN}-IDEM-'||n,'${ACTOR}',
          timestamptz '2026-07-15 10:00:00+03' + (n || ' milliseconds')::interval,
          timestamptz '2026-07-15 10:00:00+03' + (n || ' milliseconds')::interval
        from pg_catalog.generate_series(1,1005) n
        returning id,order_number
      ), items as (
        insert into public.sales_order_items(order_id,product_id,variant_id,product_sku,variant_sku,name,name_en,name_gr,size,quantity,unit_price,discount_total,line_total,created_at)
        select i.id,${productId},'${variants[0]}','${TOKEN}','${TOKEN}-S','Internal','Audit item','Audit item','S',1,10,0,10,timestamptz '2026-07-15 10:00:00+03'
        from inserted i returning order_id
      ), paid as (
        insert into public.payments(order_id,method,amount,currency,status,created_at)
        select i.id,'cash',10,'EUR','paid',timestamptz '2026-07-15 10:00:00+03' from inserted i returning order_id
      )
      insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by,created_at)
      select '${variants[0]}',l.id,'sale',-1,2000,1999,'Operations audit','pos_sale',i.id::text,'${TOKEN}-MOV-'||i.order_number,'${ACTOR}',timestamptz '2026-07-15 10:00:00+03'
      from inserted i cross join public.inventory_locations l where l.code='MAIN_STORE';
    `);

    const daily = await rpc("pos_daily_report_rpc", { p_business_date: "2026-07-15", p_limit: 100, p_offset: 0 });
    assert.equal(Number(daily.summary.ordersTotal), 1005);
    assert.equal(Number(daily.summary.grossSales), 10050);
    assert.equal(Number(daily.summary.itemsSold), 1005);
    assert.equal(daily.orders.length, 100);
    assert.equal(Number(daily.health.issueOrders), 0);
    const tail = await rpc("pos_daily_report_rpc", { p_business_date: "2026-07-15", p_limit: 100, p_offset: 1000 });
    assert.equal(tail.orders.length, 5);
    const orders = await rpc("pos_orders_page_rpc", { p_query: TOKEN, p_status: "all", p_payment_method: "all", p_date_range: "all", p_limit: 200, p_offset: 1000 });
    assert.equal(Number(orders.total), 1005);
    assert.equal(orders.orders.length, 5);
    console.log("PASS database aggregation and pagination beyond 1000 orders");

    const corruptOrder = sql(`select id from public.sales_orders where order_number='${TOKEN}-0001';`);
    sql(`update public.payments set amount=9 where order_id='${corruptOrder}';`);
    const corrupted = await rpc("pos_reconciliation_rpc", { p_order_id: corruptOrder, p_limit: 10, p_offset: 0 });
    assert.equal(Number(corrupted.issue_count), 1);
    assert.equal(corrupted.items[0].payment_mismatch, true);
    sql(`update public.payments set amount=10 where order_id='${corruptOrder}';`);
    const repaired = await rpc("pos_reconciliation_rpc", { p_order_id: corruptOrder, p_limit: 10, p_offset: 0 });
    assert.equal(Number(repaired.issue_count), 0);
    console.log("PASS partial order/payment/ledger corruption detection");

    const audit = await service.from("audit_logs").select("id,actor_user_id,actor_role,auth_type").eq("actor", ACTOR).eq("action", "pos_checkout").limit(1).single();
    if (audit.error) throw audit.error;
    assert.equal(audit.data.actor_user_id, ACTOR_ID);
    assert.equal(audit.data.actor_role, "owner");
    assert.equal(audit.data.auth_type, "account");
    const deniedUpdate = await service.from("audit_logs").update({ action: "tampered" }).eq("id", audit.data.id);
    assert.ok(deniedUpdate.error, "service_role unexpectedly changed append-only audit data");
    sqlFails(`set role service_role; update public.audit_logs set action='tampered' where id='${audit.data.id}';`, /permission denied|append-only/i);
    console.log("PASS structured actor attribution and append-only audit boundary");

    const sameRequest = `${TOKEN}-BAR-SAME`;
    const assignments = [{ variant_id: variants[1], barcode: null }];
    const [first, replay] = await Promise.all([
      barcode(sameRequest, assignments, "variant_sku"),
      barcode(sameRequest, assignments, "variant_sku"),
    ]);
    assert.equal(first.error, null);
    assert.equal(replay.error, null);
    assert.equal([first.data.already_processed, replay.data.already_processed].filter(Boolean).length, 1);
    assert.equal(sql(`select count(*) from public.barcode_operations where client_request_id='${sameRequest}';`), "1");

    const batchRequest = `${TOKEN}-BAR-BATCH`;
    const duplicateBatch = await barcode(batchRequest, [
      { variant_id: variants[2], barcode: `${TOKEN}-DUPLICATE` },
      { variant_id: variants[3], barcode: `${TOKEN}-DUPLICATE` },
    ]);
    assert.ok(duplicateBatch.error);
    assert.equal(sql(`select count(*) from public.product_variants where id in ('${variants[2]}','${variants[3]}') and barcode is not null;`), "0");
    assert.equal(sql(`select count(*) from public.barcode_operations where client_request_id='${batchRequest}';`), "0");

    const concurrentBarcode = `${TOKEN}-CONCURRENT`;
    const concurrent = await Promise.all([
      barcode(`${TOKEN}-BAR-C1`, [{ variant_id: variants[2], barcode: concurrentBarcode }]),
      barcode(`${TOKEN}-BAR-C2`, [{ variant_id: variants[3], barcode: concurrentBarcode }]),
    ]);
    assert.equal(concurrent.filter((result) => !result.error).length, 1);
    assert.equal(concurrent.filter((result) => result.error).length, 1);
    assert.equal(sql(`select count(*) from public.product_variants where barcode='${concurrentBarcode}';`), "1");

    const failedConcurrentIndex = concurrent.findIndex((result) => Boolean(result.error));
    const historyVariant = failedConcurrentIndex === 0 ? variants[2] : variants[3];
    const initialHistory = await barcode(`${TOKEN}-BAR-HISTORY-1`, [{ variant_id: historyVariant, barcode: `${TOKEN}-HISTORY-A` }]);
    if (initialHistory.error) throw initialHistory.error;
    sql(`insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by) select '${historyVariant}',id,'correction',0,0,0,'History lock audit','audit','${TOKEN}-HISTORY','${TOKEN}-HISTORY','${ACTOR}' from public.inventory_locations where code='MAIN_STORE';`);
    const historyChange = await barcode(`${TOKEN}-BAR-HISTORY-2`, [{ variant_id: historyVariant, barcode: `${TOKEN}-HISTORY-B` }]);
    assert.ok(historyChange.error);
    assert.match(historyChange.error.message, /BARCODE_HISTORY_LOCKED/);
    assert.equal(sql(`select barcode from public.product_variants where id='${historyVariant}';`), `${TOKEN}-HISTORY-A`);
    const preserve = await barcode(`${TOKEN}-BAR-HISTORY-3`, [{ variant_id: historyVariant, barcode: null }], "variant_sku");
    if (preserve.error) throw preserve.error;
    assert.equal(sql(`select barcode from public.product_variants where id='${historyVariant}';`), `${TOKEN}-HISTORY-A`);
    console.log("PASS barcode idempotency, concurrency, all-or-nothing and history stability");
  } finally {
    cleanup();
  }

  for (const check of [
    `select count(*) from public.products where sku='${TOKEN}'`,
    `select count(*) from public.sales_orders where order_number like '${TOKEN}%'`,
    `select count(*) from public.barcode_operations where actor='${ACTOR}'`,
    `select count(*) from public.audit_logs where actor='${ACTOR}'`,
  ]) assert.equal(sql(check), "0", `cleanup residue for ${check}`);
  console.log("PASS operations integration cleanup exact zero");
}

main().catch((error) => {
  try { cleanup(); } catch {}
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
