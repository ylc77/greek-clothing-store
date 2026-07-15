import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// P2 4B database contract exercised by this suite:
//   product_import_start_rpc(text,text,text,text,text,jsonb,text,text)
//   product_import_apply_row_rpc(uuid,integer,text,text)
//   product_import_refresh_job_rpc(uuid)
//   product_import_runtime_health_rpc()
//   product_import_reconciliation_rpc(uuid)
// Rows supplied to start_rpc contain row_number, normalized_sku, row_hash,
// metadata and variants. The committed migration is expected to keep each row's
// product/Variant/balance/movement writes and success marker in one transaction.

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const PREFIX = "AUDIT-CSV-";
const ACTOR = "owner:csv-import-integration-test";
const SOURCE = "csv_import_integration_test";
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
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = createClient(local.API_URL, local.ANON_KEY, {
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

function id(label) {
  return `${PREFIX}${label}-${randomUUID()}`;
}

function sku(label) {
  return id(label).replace(/[^A-Z0-9-]/g, "");
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function variant(productSku, size, quantity, overrides = {}) {
  const normalizedSize = String(size).trim().toUpperCase();
  const suffix = normalizedSize.replace(/[^A-Z0-9]+/g, "-");
  return {
    id: overrides.id,
    variant_sku: overrides.variant_sku || `${productSku}-${suffix}`,
    barcode: overrides.barcode === undefined ? `${productSku}-BAR-${suffix}` : overrides.barcode,
    size: normalizedSize,
    color: overrides.color || "BLACK",
    quantity,
    expected_on_hand: overrides.expected_on_hand,
    price: overrides.price ?? 19.9,
    cost_price: overrides.cost_price ?? null,
    supplier_id: overrides.supplier_id ?? null,
    supplier_sku: overrides.supplier_sku || "",
    reorder_level: overrides.reorder_level ?? null,
    active: overrides.active !== false,
    sort_order: overrides.sort_order ?? 0,
  };
}

function metadata(productSku, name = "CSV integration product", overrides = {}) {
  return {
    sku: productSku,
    name_cn: overrides.name_cn || name,
    name_en: overrides.name_en || name,
    name_gr: overrides.name_gr || name,
    description_cn: "",
    description_en: "",
    description_gr: "",
    category: overrides.category || "women",
    subcategory: overrides.subcategory || "dresses",
    price: overrides.price ?? 19.9,
    stock: overrides.stock ?? 0,
    sizes: overrides.sizes || "",
    size_stock: overrides.size_stock || {},
    image_url: "",
    image_urls: [],
    image_width: null,
    image_height: null,
    brand: overrides.brand || "Audit CSV",
    barcode: "",
    ean: "",
    vat: 24,
    color: "BLACK",
    additional_image_urls: "",
    skroutz_url: "",
    material: "",
    fit: "",
    season: "",
    mpn: "",
    availability: "",
    size_chart: {},
    size_system: overrides.size_system || "letter",
    fit_type: "regular",
    style_tags: [],
    ai_keywords: [],
    material_verified: false,
    category_path_en: "Women > Dresses",
    category_path_gr: "Women > Dresses",
    supplier_id: null,
    supplier_sku: "",
    purchase_price: null,
    is_active: overrides.is_active !== false,
  };
}

function importRow(rowNumber, productSku, variants, overrides = {}) {
  const row = {
    row_number: rowNumber,
    normalized_sku: productSku.trim().toUpperCase(),
    metadata: metadata(productSku, overrides.name || `CSV row ${rowNumber}`, overrides.metadata),
    variants,
  };
  return { ...row, row_hash: hash(row) };
}

function jobPayload(rows, overrides = {}) {
  return {
    clientRequestId: overrides.clientRequestId || id("JOB"),
    payloadHash: overrides.payloadHash || hash(rows),
    filename: overrides.filename || `${PREFIX.toLowerCase()}fixture.csv`,
    importMode: overrides.importMode || "create_only",
    inventoryMode: overrides.inventoryMode || "set_inventory",
    rows,
  };
}

async function startJobRaw(payload) {
  return service.rpc("product_import_start_rpc", {
    p_client_request_id: payload.clientRequestId,
    p_payload_hash: payload.payloadHash,
    p_filename: payload.filename,
    p_import_mode: payload.importMode,
    p_inventory_mode: payload.inventoryMode,
    p_rows: payload.rows,
    p_actor: ACTOR,
    p_source: SOURCE,
  });
}

function resultJob(value) {
  return value?.job || value;
}

async function startJob(payload) {
  const { data, error } = await startJobRaw(payload);
  if (error) throw error;
  const job = resultJob(data);
  assert.match(String(job?.id || ""), /^[0-9a-f-]{36}$/i, JSON.stringify(data));
  return { data, job };
}

async function applyRowRaw(jobId, rowNumber) {
  return service.rpc("product_import_apply_row_rpc", {
    p_job_id: jobId,
    p_row_number: rowNumber,
    p_actor: ACTOR,
    p_source: SOURCE,
  });
}

async function applyRow(jobId, rowNumber) {
  const { data, error } = await applyRowRaw(jobId, rowNumber);
  if (error) throw error;
  return data;
}

async function refreshJob(jobId) {
  const { data, error } = await service.rpc("product_import_refresh_job_rpc", { p_job_id: jobId });
  if (error) throw error;
  return resultJob(data);
}

async function databaseJob(jobId) {
  const { data, error } = await service.from("product_import_jobs").select("*").eq("id", jobId).single();
  if (error) throw error;
  return data;
}

async function databaseRows(jobId) {
  const { data, error } = await service.from("product_import_rows").select("*").eq("job_id", jobId).order("row_number");
  if (error) throw error;
  return data || [];
}

async function databaseProduct(productSku) {
  const { data, error } = await service.from("products").select("*").eq("sku", productSku).maybeSingle();
  if (error) throw error;
  return data;
}

async function productState(productSku) {
  const product = await databaseProduct(productSku);
  if (!product) return null;
  const { data: variants, error: variantError } = await service.from("product_variants")
    .select("*").eq("product_id", product.id).order("sort_order").order("id");
  if (variantError) throw variantError;
  const variantIds = (variants || []).map((item) => item.id);
  const { data: balances, error: balanceError } = variantIds.length === 0
    ? { data: [], error: null }
    : await service.from("inventory_balances").select("*").in("variant_id", variantIds).order("variant_id");
  if (balanceError) throw balanceError;
  const { data: movements, error: movementError } = variantIds.length === 0
    ? { data: [], error: null }
    : await service.from("stock_movements").select("*").in("variant_id", variantIds).order("id");
  if (movementError) throw movementError;
  return { product, variants: variants || [], balances: balances || [], movements: movements || [] };
}

function onHandBySize(state) {
  const balanceByVariant = new Map(state.balances.map((item) => [item.variant_id, Number(item.quantity_on_hand)]));
  return Object.fromEntries(state.variants.filter((item) => item.active).map((item) => [
    String(item.size).toUpperCase(),
    balanceByVariant.get(item.id) || 0,
  ]));
}

async function seedProduct(productSku, specs, overrides = {}) {
  const variants = specs.map((spec, index) => variant(productSku, spec.size, spec.quantity, { ...spec, sort_order: index }));
  const meta = metadata(productSku, overrides.name || "Seed product", {
    ...overrides,
    stock: variants.reduce((sum, item) => sum + item.quantity, 0),
    sizes: variants.map((item) => item.size).join(","),
    size_stock: Object.fromEntries(variants.map((item) => [item.size, item.quantity])),
  });
  const { error } = await service.rpc("product_create_rpc", {
    p_client_request_id: id("SEED"),
    p_metadata: meta,
    p_variants: variants,
    p_actor: ACTOR,
    p_source: SOURCE,
  });
  if (error) throw error;
  return productState(productSku);
}

async function assertProjection(productSku) {
  const state = await productState(productSku);
  assert.ok(state, `${productSku} was not created`);
  const sizes = onHandBySize(state);
  assert.deepEqual(state.product.size_stock, sizes);
  assert.equal(Number(state.product.stock), Object.values(sizes).reduce((sum, quantity) => sum + quantity, 0));
  return state;
}

async function cleanup() {
  sql(`
    delete from public.product_import_rows where job_id in (
      select id from public.product_import_jobs where client_request_id like ${quote(`${PREFIX}%`)}
    );
    delete from public.product_import_jobs where client_request_id like ${quote(`${PREFIX}%`)};
    delete from public.product_operations
    where client_request_id like ${quote(`${PREFIX}%`)}
       or product_id in (select id from public.products where sku like ${quote(`${PREFIX}%`)});
    delete from public.inventory_operations where operation_key like ${quote(`inventory:${PREFIX}%`)};
    delete from public.stock_movements where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.inventory_balances where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.product_variants where product_id in (
      select id from public.products where sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.products where sku like ${quote(`${PREFIX}%`)};
  `);
}

async function assertClean() {
  const counts = {
    jobs: Number(sql(`select count(*) from public.product_import_jobs where client_request_id like ${quote(`${PREFIX}%`)};`)),
    rows: Number(sql(`select count(*) from public.product_import_rows r join public.product_import_jobs j on j.id = r.job_id where j.client_request_id like ${quote(`${PREFIX}%`)};`)),
    products: Number(sql(`select count(*) from public.products where sku like ${quote(`${PREFIX}%`)};`)),
    variants: Number(sql(`select count(*) from public.product_variants where variant_sku like ${quote(`${PREFIX}%`)};`)),
  };
  assert.deepEqual(counts, { jobs: 0, rows: 0, products: 0, variants: 0 });
}

function installFaultHarness() {
  sql(`
    drop schema if exists audit_csv_test cascade;
    create schema audit_csv_test;
    create table audit_csv_test.config(stage text not null);
    create function audit_csv_test.fail_stage() returns trigger
    language plpgsql security definer set search_path = pg_catalog, public, audit_csv_test as $$
    declare product_sku text;
    begin
      if not exists (select 1 from audit_csv_test.config where stage = 'movement') then return new; end if;
      select p.sku into product_sku
      from public.product_variants v join public.products p on p.id = v.product_id
      where v.id = new.variant_id;
      if product_sku like '${PREFIX}%' then raise exception 'AUDIT_CSV_FAULT:movement'; end if;
      return new;
    end;
    $$;
    create trigger audit_csv_fail_movement before insert on public.stock_movements
    for each row execute function audit_csv_test.fail_stage();
  `);
}

function setFault(enabled) {
  sql(`truncate audit_csv_test.config; ${enabled ? "insert into audit_csv_test.config values ('movement');" : ""}`);
}

function uninstallFaultHarness() {
  sql(`
    drop trigger if exists audit_csv_fail_movement on public.stock_movements;
    drop schema if exists audit_csv_test cascade;
  `);
}

try {
  await cleanup();

  await runCase("CSV runtime health and service-only permission boundary are ready", async () => {
    const { data, error } = await service.rpc("product_import_runtime_health_rpc");
    if (error) throw error;
    assert.equal(data?.ready, true, JSON.stringify(data));
    assert.equal(Number(sql("select count(*) from public.product_import_jobs;")), 0, "local fixture must start with no import jobs");
    assert.equal(Number(sql("select count(*) from public.product_import_rows;")), 0, "local fixture must start with no import rows");
    for (const table of ["product_import_jobs", "product_import_rows"]) {
      assert.equal(sql(`select has_table_privilege('anon', 'public.${table}', 'select');`), "f");
      assert.equal(sql(`select has_table_privilege('authenticated', 'public.${table}', 'select');`), "f");
      assert.equal(sql(`select has_table_privilege('anon', 'public.${table}', 'insert,update,delete');`), "f");
      const attempt = await anonymous.from(table).select("*").limit(1);
      assert.ok(attempt.error, `${table} unexpectedly readable by anon`);
    }
    for (const signature of [
      "public.product_import_start_rpc(text,text,text,text,text,jsonb,text,text)",
      "public.product_import_apply_row_rpc(uuid,integer,text,text)",
      "public.product_import_refresh_job_rpc(uuid)",
      "public.product_import_reconciliation_rpc(uuid)",
    ]) {
      assert.equal(sql(`select has_function_privilege('anon', ${quote(signature)}, 'execute');`), "f", signature);
      assert.equal(sql(`select has_function_privilege('authenticated', ${quote(signature)}, 'execute');`), "f", signature);
      assert.equal(sql(`select has_function_privilege('service_role', ${quote(signature)}, 'execute');`), "t", signature);
    }
  });

  await runCase("same operation and payload replays one job while a changed payload conflicts", async () => {
    const productSku = sku("JOB-REPLAY");
    const rows = [importRow(1, productSku, [variant(productSku, "S", 1)])];
    const payload = jobPayload(rows);
    const first = await startJob(payload);
    const replay = await startJob(payload);
    assert.equal(replay.job.id, first.job.id);
    assert.equal(Number(sql(`select count(*) from public.product_import_jobs where client_request_id = ${quote(payload.clientRequestId)};`)), 1);
    assert.equal((await databaseRows(first.job.id)).length, 1);

    const changed = { ...payload, payloadHash: hash([...rows, { changed: true }]) };
    const conflict = await startJobRaw(changed);
    assert.ok(conflict.error, JSON.stringify(conflict.data));
    assert.match(`${conflict.error.code || ""} ${conflict.error.message || ""}`, /IDEMPOTENCY|PAYLOAD|CONFLICT/i);
    assert.equal((await databaseRows(first.job.id)).length, 1);
  });

  await runCase("create_only creates multi-size and ONE SIZE rows atomically", async () => {
    const multiSku = sku("CREATE-MULTI");
    const oneSku = sku("CREATE-ONE");
    const rows = [
      importRow(1, multiSku, [variant(multiSku, "S", 2), variant(multiSku, "M", 3, { sort_order: 1 })]),
      importRow(2, oneSku, [variant(oneSku, "ONE SIZE", 4)], { metadata: { size_system: "one_size" } }),
    ];
    const { job } = await startJob(jobPayload(rows, { importMode: "create_only", inventoryMode: "set_inventory" }));
    await Promise.all(rows.map((row) => applyRow(job.id, row.row_number)));
    const summary = await refreshJob(job.id);
    assert.equal(Number(summary.succeeded_rows), 2, JSON.stringify(summary));
    assert.equal(Number(summary.failed_rows), 0, JSON.stringify(summary));
    assert.deepEqual(onHandBySize(await assertProjection(multiSku)), { S: 2, M: 3 });
    assert.deepEqual(onHandBySize(await assertProjection(oneSku)), { "ONE SIZE": 4 });
  });

  await runCase("create_only and update_existing enforce existence semantics", async () => {
    const existingSku = sku("MODE-EXISTING");
    const missingSku = sku("MODE-MISSING");
    await seedProduct(existingSku, [{ size: "S", quantity: 2 }], { name: "Before mode test" });

    const createRow = importRow(1, existingSku, [variant(existingSku, "S", 99)], { name: "Must not overwrite" });
    const { job: createJob } = await startJob(jobPayload([createRow], { importMode: "create_only" }));
    await applyRow(createJob.id, 1);
    const [createResult] = await databaseRows(createJob.id);
    assert.equal(createResult.status, "failed");
    assert.match(`${createResult.error_code || ""} ${createResult.error_summary || ""}`, /EXIST|CONFLICT/i);
    assert.equal((await databaseProduct(existingSku)).name_en, "Before mode test");
    assert.deepEqual(onHandBySize(await productState(existingSku)), { S: 2 });

    const missingRow = importRow(1, missingSku, [variant(missingSku, "S", 1)]);
    const { job: missingJob } = await startJob(jobPayload([missingRow], { importMode: "update_existing" }));
    await applyRow(missingJob.id, 1);
    const [missingResult] = await databaseRows(missingJob.id);
    assert.equal(missingResult.status, "failed");
    assert.match(`${missingResult.error_code || ""} ${missingResult.error_summary || ""}`, /NOT.?FOUND|MISSING/i);
    assert.equal(await databaseProduct(missingSku), null);
  });

  await runCase("metadata_only never changes inventory and upsert creates or updates", async () => {
    const existingSku = sku("UPSERT-EXISTING");
    const newSku = sku("UPSERT-NEW");
    await seedProduct(existingSku, [{ size: "S", quantity: 2 }, { size: "M", quantity: 5 }], { name: "Before upsert" });
    const rows = [
      importRow(1, existingSku, [variant(existingSku, "S", 99)], { name: "After upsert metadata" }),
      importRow(2, newSku, [variant(newSku, "ONE SIZE", 8)], { name: "New upsert product" }),
    ];
    const { job } = await startJob(jobPayload(rows, { importMode: "upsert", inventoryMode: "metadata_only" }));
    await Promise.all(rows.map((row) => applyRow(job.id, row.row_number)));
    await refreshJob(job.id);
    assert.equal((await databaseProduct(existingSku)).name_en, "After upsert metadata");
    assert.deepEqual(onHandBySize(await productState(existingSku)), { S: 2, M: 5 });
    assert.ok(await databaseProduct(newSku));
    assert.deepEqual(onHandBySize(await productState(newSku)), { "ONE SIZE": 0 });
  });

  await runCase("set_inventory preserves an omitted size and protects reserved stock", async () => {
    const productSku = sku("INVENTORY-MERGE");
    let state = await seedProduct(productSku, [{ size: "S", quantity: 2 }, { size: "M", quantity: 5 }]);
    const sVariant = state.variants.find((item) => item.size === "S");
    const setS = importRow(1, productSku, [variant(productSku, "S", 7, {
      id: sVariant.id,
      variant_sku: sVariant.variant_sku,
      barcode: sVariant.barcode,
      expected_on_hand: 2,
    })], { name: "Merged inventory" });
    const { job } = await startJob(jobPayload([setS], { importMode: "update_existing", inventoryMode: "set_inventory" }));
    await applyRow(job.id, 1);
    state = await assertProjection(productSku);
    assert.deepEqual(onHandBySize(state), { S: 7, M: 5 });

    const { error: reserveError } = await service.from("inventory_balances")
      .update({ quantity_reserved: 1 }).eq("variant_id", sVariant.id);
    if (reserveError) throw reserveError;
    const reservedRow = importRow(1, productSku, [variant(productSku, "S", 0, {
      id: sVariant.id,
      variant_sku: sVariant.variant_sku,
      barcode: sVariant.barcode,
      expected_on_hand: 7,
    })]);
    const { job: reservedJob } = await startJob(jobPayload([reservedRow], { importMode: "update_existing", inventoryMode: "set_inventory" }));
    await applyRow(reservedJob.id, 1);
    const [failed] = await databaseRows(reservedJob.id);
    assert.equal(failed.status, "failed");
    assert.match(`${failed.error_code || ""} ${failed.error_summary || ""}`, /RESERV/i);
    assert.deepEqual(onHandBySize(await productState(productSku)), { S: 7, M: 5 });
  });

  await runCase("row fault rolls product writes back; failed retry succeeds; succeeded replay is a no-op", async () => {
    const productSku = sku("ROW-FAULT");
    const row = importRow(1, productSku, [variant(productSku, "S", 3)]);
    const { job } = await startJob(jobPayload([row]));
    installFaultHarness();
    try {
      setFault(true);
      await applyRow(job.id, 1);
      let [stored] = await databaseRows(job.id);
      assert.equal(stored.status, "failed");
      assert.equal(await databaseProduct(productSku), null, "failed row leaked a product");
      assert.equal(Number(stored.attempt_count), 1);

      setFault(false);
      await applyRow(job.id, 1);
      [stored] = await databaseRows(job.id);
      assert.equal(stored.status, "succeeded");
      assert.equal(Number(stored.attempt_count), 2);
      const before = await productState(productSku);
      const operationId = stored.operation_id;
      await applyRow(job.id, 1);
      const after = await productState(productSku);
      const [replayed] = await databaseRows(job.id);
      assert.equal(replayed.operation_id, operationId);
      assert.equal(Number(replayed.attempt_count), 2, "successful row was executed again");
      assert.equal(after.movements.length, before.movements.length);
      assert.deepEqual(onHandBySize(after), { S: 3 });
    } finally {
      uninstallFaultHarness();
    }
  });

  await runCase("20 concurrent job replays and 20 concurrent row applies produce one result", async () => {
    const productSku = sku("CONCURRENT-REPLAY");
    const row = importRow(1, productSku, [variant(productSku, "S", 1)]);
    const payload = jobPayload([row]);
    const starts = await Promise.all(Array.from({ length: 20 }, () => startJob(payload)));
    assert.equal(new Set(starts.map((item) => item.job.id)).size, 1);
    const jobId = starts[0].job.id;
    const applies = await Promise.all(Array.from({ length: 20 }, () => applyRowRaw(jobId, 1)));
    assert.ok(applies.every((item) => !item.error), applies.map((item) => item.error));
    const [stored] = await databaseRows(jobId);
    assert.equal(stored.status, "succeeded");
    assert.equal(Number(stored.attempt_count), 1);
    const state = await assertProjection(productSku);
    assert.deepEqual(onHandBySize(state), { S: 1 });
    assert.equal(state.movements.length, 1);
  });

  await runCase("two create_only jobs racing on one SKU create one product and one safe failure", async () => {
    const productSku = sku("TWO-JOBS");
    const rowA = importRow(1, productSku, [variant(productSku, "S", 1)]);
    const rowB = importRow(1, productSku, [variant(productSku, "S", 2)]);
    const [{ job: jobA }, { job: jobB }] = await Promise.all([
      startJob(jobPayload([rowA], { clientRequestId: id("TWO-JOBS-A") })),
      startJob(jobPayload([rowB], { clientRequestId: id("TWO-JOBS-B") })),
    ]);
    await Promise.all([applyRow(jobA.id, 1), applyRow(jobB.id, 1)]);
    const statuses = [(await databaseRows(jobA.id))[0].status, (await databaseRows(jobB.id))[0].status].sort();
    assert.deepEqual(statuses, ["failed", "succeeded"]);
    assert.equal(Number(sql(`select count(*) from public.products where sku = ${quote(productSku)};`)), 1);
    await assertProjection(productSku);
  });

  await runCase("job summary refresh and reconciliation detect and repair cached count drift", async () => {
    const successSku = sku("SUMMARY-SUCCESS");
    const missingSku = sku("SUMMARY-MISSING");
    const rows = [
      importRow(1, successSku, [variant(successSku, "S", 1)]),
      importRow(2, missingSku, [variant(missingSku, "S", 1)]),
      importRow(3, sku("SUMMARY-PENDING"), []),
    ];
    const { job } = await startJob(jobPayload(rows, { importMode: "update_existing" }));
    await seedProduct(successSku, [{ size: "S", quantity: 0 }]);
    await applyRow(job.id, 1);
    await applyRow(job.id, 2);
    let summary = await refreshJob(job.id);
    assert.equal(Number(summary.succeeded_rows), 1);
    assert.equal(Number(summary.failed_rows), 1);
    assert.equal(Number(summary.pending_rows), 1);

    const { error: corruptError } = await service.from("product_import_jobs")
      .update({ succeeded_rows: 99, failed_rows: 99, pending_rows: 99 }).eq("id", job.id);
    if (corruptError) throw corruptError;
    let reconciliation = await service.rpc("product_import_reconciliation_rpc", { p_job_id: job.id });
    if (reconciliation.error) throw reconciliation.error;
    assert.equal(reconciliation.data?.healthy, false, JSON.stringify(reconciliation.data));
    assert.ok(Array.isArray(reconciliation.data?.summary_mismatches));
    assert.ok(reconciliation.data.summary_mismatches.length > 0);
    summary = await refreshJob(job.id);
    assert.equal(Number(summary.succeeded_rows), 1);
    assert.equal(Number(summary.failed_rows), 1);
    assert.equal(Number(summary.pending_rows), 1);
    reconciliation = await service.rpc("product_import_reconciliation_rpc", { p_job_id: job.id });
    if (reconciliation.error) throw reconciliation.error;
    assert.equal(reconciliation.data?.healthy, true, JSON.stringify(reconciliation.data));
  });
} finally {
  try { uninstallFaultHarness(); } catch {}
  try { await cleanup(); } catch (error) {
    results.push({ name: "final CSV cleanup", ok: false, error });
  }
}

await runCase("CSV integration test data is fully cleaned", assertClean);

const failures = results.filter((result) => !result.ok);
console.log(`\nCSV import integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) {
  console.error(`Failed cases: ${failures.map((failure) => failure.name).join(", ")}`);
  process.exitCode = 1;
}
