import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const TOKEN = `AUDIT-BARCODE-${randomUUID().replaceAll("-", "").toUpperCase()}`;
const ACTOR = `account:owner:${randomUUID()}`;

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`);
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", ["exec", "-i", DB_CONTAINER, "psql", "-q", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement });
}

function localEnvironment() {
  const output = process.platform === "win32"
    ? command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx supabase status -o env"])
    : command("npx", ["supabase", "status", "-o", "env"]);
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

const local = localEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function generate(requestId, variantIds) {
  return service.rpc("variant_barcodes_generate_missing_rpc", {
    p_client_request_id: requestId,
    p_variant_ids: variantIds,
    p_actor: ACTOR,
  });
}

function cleanup() {
  sql(`
    delete from public.audit_logs where actor = '${ACTOR}';
    delete from public.barcode_operations where actor = '${ACTOR}';
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
    const productId = Number(sql(`insert into public.products(sku,name_cn,name_en,name_gr,category,subcategory,price,stock,sizes,size_stock,is_active) values('${TOKEN}','Barcode audit','Barcode audit','Barcode audit','audit','barcode',10,0,'S,M,L,XL','{}'::jsonb,true) returning id;`));
    const ids = Array.from({ length: 5 }, () => randomUUID());
    sql(`
      insert into public.product_variants(id,product_id,variant_sku,size,barcode,price,active,sort_order) values
      ('${ids[0]}',${productId},'${TOKEN}-S','S',null,10,true,0),
      ('${ids[1]}',${productId},'${TOKEN}-M','M','${TOKEN}-EXISTING',10,true,1),
      ('${ids[2]}',${productId},'${TOKEN}-L','L',null,10,true,2),
      ('${ids[3]}',${productId},'${TOKEN}-XL','XL','${TOKEN}-L',10,true,3),
      ('${ids[4]}',${productId},'${TOKEN}-ONE','ONE SIZE',null,10,true,4);
    `);

    const requestId = `${TOKEN}-MIXED`;
    const mixed = await generate(requestId, [ids[0], ids[1], ids[2]]);
    if (mixed.error) throw mixed.error;
    assert.equal(mixed.data.requested, 3);
    assert.equal(mixed.data.generated, 1);
    assert.equal(mixed.data.skipped_existing, 1);
    assert.equal(mixed.data.failed, 1);
    assert.deepEqual(mixed.data.items.map((item) => item.status).sort(), ["failed", "generated", "skipped_existing"]);
    assert.equal(sql(`select barcode from public.product_variants where id='${ids[0]}';`), `${TOKEN}-S`);
    assert.equal(sql(`select barcode from public.product_variants where id='${ids[1]}';`), `${TOKEN}-EXISTING`);
    assert.equal(sql(`select coalesce(barcode,'') from public.product_variants where id='${ids[2]}';`), "");

    const replay = await generate(requestId, [ids[2], ids[1], ids[0], ids[0]]);
    if (replay.error) throw replay.error;
    assert.equal(replay.data.already_processed, true);
    assert.deepEqual(replay.data.items, mixed.data.items);
    assert.equal(sql(`select count(*) from public.barcode_operations where client_request_id='${requestId}';`), "1");

    const differentPayload = await generate(requestId, [ids[4]]);
    assert.ok(differentPayload.error);
    assert.match(differentPayload.error.message, /BARCODE_OPERATION_CONFLICT/);

    const concurrentId = `${TOKEN}-CONCURRENT-SAME`;
    const sameRequest = await Promise.all([generate(concurrentId, [ids[4]]), generate(concurrentId, [ids[4]])]);
    assert.equal(sameRequest.filter((result) => !result.error).length, 2);
    assert.equal(sameRequest.filter((result) => result.data.already_processed).length, 1);
    assert.equal(sql(`select barcode from public.product_variants where id='${ids[4]}';`), `${TOKEN}-ONE`);
    assert.equal(sql(`select count(*) from public.barcode_operations where client_request_id='${concurrentId}';`), "1");

    const missingVariant = randomUUID();
    const missing = await generate(`${TOKEN}-NOT-FOUND`, [missingVariant]);
    if (missing.error) throw missing.error;
    assert.equal(missing.data.failed, 1);
    assert.equal(missing.data.items[0].variantId, missingVariant);
    assert.equal(missing.data.items[0].status, "failed");
    assert.equal(missing.data.items[0].code, "BARCODE_VARIANT_NOT_FOUND");

    console.log("PASS bulk Barcode generation skips existing values, reports item failures and preserves idempotency under concurrency");
  } finally {
    cleanup();
  }

  for (const check of [
    `select count(*) from public.products where sku='${TOKEN}'`,
    `select count(*) from public.barcode_operations where actor='${ACTOR}'`,
    `select count(*) from public.audit_logs where actor='${ACTOR}'`,
  ]) assert.equal(sql(check), "0", `cleanup residue for ${check}`);
  console.log("PASS bulk Barcode integration cleanup exact zero");
}

main().catch((error) => {
  try { cleanup(); } catch {}
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
