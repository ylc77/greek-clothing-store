import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3312;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PASSWORDS = {
  owner: "audit-product-owner",
  staff: "audit-product-staff",
  inventory: "audit-product-inventory",
  readonly: "audit-product-readonly",
};
const AUDIT_PREFIX = "AUDIT-PRODUCT-";
const CREATED_BY = "product-transaction-integration-test";
const PRODUCT_CREATE_SIGNATURE = "public.product_create_rpc(text,jsonb,jsonb,text,text)";
const PRODUCT_UPDATE_SIGNATURE = "public.product_update_rpc(text,bigint,bigint,bigint,jsonb,jsonb,text,text)";
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

function auditSku(label) {
  return auditId(label).replace(/[^A-Z0-9-]/gi, "").toUpperCase();
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizedSize(value) {
  return String(value || "ONE SIZE").trim().toUpperCase();
}

function variantInput(sku, size, quantity, overrides = {}) {
  const normalized = normalizedSize(size);
  return {
    id: overrides.id,
    variant_sku: overrides.variant_sku || `${sku}-${normalized.replace(/[^A-Z0-9]+/g, "-")}`,
    barcode: overrides.barcode === undefined
      ? `${sku}-BAR-${normalized.replace(/[^A-Z0-9]+/g, "-")}`
      : overrides.barcode,
    size: normalized,
    color: overrides.color || "BLACK",
    quantity,
    price: overrides.price ?? 19.9,
    cost_price: overrides.cost_price ?? null,
    supplier_id: overrides.supplier_id ?? null,
    supplier_sku: overrides.supplier_sku || "",
    reorder_level: overrides.reorder_level ?? null,
    active: overrides.active !== false,
    sort_order: overrides.sort_order ?? 0,
  };
}

function productPayload(label, variantSpecs, overrides = {}) {
  const sku = overrides.sku || auditSku(label);
  const variants = variantSpecs.map((spec, index) => variantInput(
    sku,
    spec.size,
    spec.quantity,
    { ...spec, sort_order: spec.sort_order ?? index },
  ));
  const sizeStock = Object.fromEntries(variants.map((variant) => [variant.size, Number(variant.quantity)]));
  return {
    sku,
    name_cn: overrides.name_cn || `商品事务测试 ${label}`,
    name_en: overrides.name_en || `Product transaction ${label}`,
    name_gr: overrides.name_gr || `Product transaction ${label}`,
    description_cn: overrides.description_cn || "",
    description_en: overrides.description_en || "",
    description_gr: overrides.description_gr || "",
    category: overrides.category || "women",
    subcategory: overrides.subcategory || "dresses",
    price: overrides.price ?? 19.9,
    stock: variants.reduce((sum, variant) => sum + Number(variant.quantity), 0),
    sizes: variants.map((variant) => variant.size).join(","),
    size_stock: sizeStock,
    image_url: overrides.image_url || "",
    image_urls: overrides.image_urls || [],
    image_width: overrides.image_width ?? null,
    image_height: overrides.image_height ?? null,
    brand: overrides.brand || "Audit Brand",
    barcode: overrides.barcode || "",
    ean: overrides.ean || "",
    vat: overrides.vat ?? 24,
    color: overrides.color || "BLACK",
    additional_image_urls: overrides.additional_image_urls || "",
    skroutz_url: overrides.skroutz_url || "",
    material: overrides.material || "",
    fit: overrides.fit || "",
    season: overrides.season || "",
    mpn: overrides.mpn || "",
    availability: overrides.availability || "",
    size_chart: overrides.size_chart || {},
    size_system: overrides.size_system || "letter",
    fit_type: overrides.fit_type || "regular",
    style_tags: overrides.style_tags || [],
    ai_keywords: overrides.ai_keywords || [],
    material_verified: overrides.material_verified || false,
    category_path_en: overrides.category_path_en || "Women > Dresses",
    category_path_gr: overrides.category_path_gr || "Women > Dresses",
    supplier_id: overrides.supplier_id ?? null,
    supplier_sku: overrides.supplier_sku || "",
    purchase_price: overrides.purchase_price ?? null,
    is_active: overrides.is_active !== false,
    variants,
  };
}

function flatProduct(product) {
  const keys = [
    "sku", "name_cn", "name_en", "name_gr", "description_cn", "description_en", "description_gr",
    "category", "subcategory", "price", "stock", "sizes", "size_stock", "image_url", "image_urls",
    "image_width", "image_height", "brand", "barcode", "ean", "vat", "color", "additional_image_urls",
    "skroutz_url", "material", "fit", "season", "mpn", "availability", "size_chart", "size_system",
    "fit_type", "style_tags", "ai_keywords", "material_verified", "category_path_en", "category_path_gr",
    "supplier_id", "supplier_sku", "purchase_price", "is_active",
  ];
  return Object.fromEntries(keys.filter((key) => key in product).map((key) => [key, product[key]]));
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

async function createProduct(payload, requestId = auditId("CREATE"), options = { role: "owner" }) {
  return api("/api/admin/products", { ...payload, clientRequestId: requestId }, options);
}

async function updateProduct(product, requestId, changes = {}, variantsMarker = undefined, options = { role: "owner" }) {
  const body = {
    ...flatProduct(product),
    ...changes,
    clientRequestId: requestId,
    expectedMetadataVersion: Number(product.metadata_version),
    expectedStructureVersion: Number(product.structure_version),
  };
  if (variantsMarker !== undefined) body.variants = variantsMarker;
  return api(`/api/admin/products/${product.id}`, body, { ...options, method: "PUT" });
}

async function adjust(variantId, requestId, quantity, role = "owner") {
  return api("/api/admin/inventory/adjust", {
    variantId,
    mode: "adjust_by",
    quantity,
    reason: "Product transaction integration adjustment",
    operationType: "manual",
    clientRequestId: requestId,
  }, { role });
}

function responseProduct(response) {
  return response.data?.product;
}

async function getProducts(role = "owner") {
  const response = await api("/api/admin/products?limit=500", undefined, { role });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(Array.isArray(response.data.products));
  return response.data.products;
}

async function getProductBySku(sku, role = "owner") {
  return (await getProducts(role)).find((product) => product.sku === sku) || null;
}

async function databaseProduct(sku) {
  const { data, error } = await supabase.from("products")
    .select("*")
    .eq("sku", sku)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function variantsForProduct(productId) {
  const { data, error } = await supabase.from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order")
    .order("id");
  if (error) throw error;
  return data || [];
}

async function balancesForProduct(productId) {
  const { data, error } = await supabase.from("inventory_balances")
    .select("id, variant_id, location_id, quantity_on_hand, quantity_reserved, updated_at, product_variants!inner(product_id)")
    .eq("product_variants.product_id", productId)
    .order("variant_id");
  if (error) throw error;
  return data || [];
}

async function movementsForProduct(productId) {
  const { data, error } = await supabase.from("stock_movements")
    .select("id, variant_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, source_type, source_id, idempotency_key, created_by, created_at, product_variants!inner(product_id)")
    .eq("product_variants.product_id", productId)
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data || [];
}

async function operationsForRequest(requestId) {
  const { data, error } = await supabase.from("product_operations")
    .select("*")
    .eq("client_request_id", requestId)
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data || [];
}

async function operationsForProduct(productId) {
  const { data, error } = await supabase.from("product_operations")
    .select("*")
    .eq("product_id", productId)
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data || [];
}

async function stateForProduct(productId) {
  const { data: product, error } = await supabase.from("products").select("*").eq("id", productId).single();
  if (error) throw error;
  return {
    product,
    variants: await variantsForProduct(productId),
    balances: await balancesForProduct(productId),
    movements: await movementsForProduct(productId),
    operations: await operationsForProduct(productId),
  };
}

function inventorySlice(state) {
  return {
    product: {
      stock: Number(state.product.stock),
      size_stock: state.product.size_stock,
      sizes: state.product.sizes,
    },
    variants: state.variants.map((variant) => ({
      id: variant.id,
      variant_sku: variant.variant_sku,
      size: variant.size,
      active: variant.active,
    })),
    balances: state.balances.map((balanceRow) => ({
      variant_id: balanceRow.variant_id,
      location_id: balanceRow.location_id,
      quantity_on_hand: Number(balanceRow.quantity_on_hand),
      quantity_reserved: Number(balanceRow.quantity_reserved),
    })),
    movements: state.movements.map((movement) => ({
      id: movement.id,
      variant_id: movement.variant_id,
      quantity_delta: Number(movement.quantity_delta),
      quantity_before: Number(movement.quantity_before),
      quantity_after: Number(movement.quantity_after),
      idempotency_key: movement.idempotency_key,
    })),
  };
}

async function createProductOrThrow(payload, requestId = auditId("CREATE")) {
  const response = await createProduct(payload, requestId);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  const product = responseProduct(response);
  assert.ok(product?.id, JSON.stringify(response.data));
  assert.equal(product.sku, payload.sku);
  assert.ok(Number.isInteger(Number(product.metadata_version)));
  assert.ok(Number.isInteger(Number(product.structure_version)));
  assert.ok(Array.isArray(product.variants));
  return { response, product, requestId };
}

async function assertProjection(productId) {
  const state = await stateForProduct(productId);
  const quantities = new Map(state.balances.map((row) => [row.variant_id, Number(row.quantity_on_hand)]));
  const activeVariants = state.variants.filter((variant) => variant.active);
  const expectedSizeStock = Object.fromEntries(activeVariants.map((variant) => [
    normalizedSize(variant.size),
    quantities.get(variant.id) || 0,
  ]));
  const expectedStock = Object.values(expectedSizeStock).reduce((sum, quantity) => sum + quantity, 0);
  assert.equal(Number(state.product.stock), expectedStock);
  assert.deepEqual(state.product.size_stock, expectedSizeStock);
  assert.deepEqual(
    String(state.product.sizes || "").split(",").filter(Boolean),
    activeVariants.map((variant) => normalizedSize(variant.size)),
  );
  return state;
}

async function assertNoProductWrites(sku, requestId) {
  assert.equal(await databaseProduct(sku), null);
  assert.equal((await operationsForRequest(requestId)).length, 0);
  const variantCount = Number(sql(`select count(*) from public.product_variants where variant_sku like ${quote(`${sku}%`)};`));
  assert.equal(variantCount, 0);
}

async function cleanupAuditData() {
  sql(`
    do $$
    begin
      if to_regclass('public.product_operations') is not null then
        delete from public.product_operations
        where client_request_id like ${quote(`${AUDIT_PREFIX}%`)}
           or product_id in (select id from public.products where sku like ${quote(`${AUDIT_PREFIX}%`)});
      end if;
      if to_regclass('public.inventory_operations') is not null then
        delete from public.inventory_operations
        where operation_key like ${quote(`inventory:${AUDIT_PREFIX}%`)};
      end if;
    end;
    $$;
    delete from public.stock_movements
    where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like ${quote(`${AUDIT_PREFIX}%`)}
    );
    delete from public.inventory_balances
    where variant_id in (
      select v.id from public.product_variants v join public.products p on p.id = v.product_id
      where p.sku like ${quote(`${AUDIT_PREFIX}%`)}
    );
    delete from public.product_variants where product_id in (
      select id from public.products where sku like ${quote(`${AUDIT_PREFIX}%`)}
    );
    delete from public.products where sku like ${quote(`${AUDIT_PREFIX}%`)};
  `);
}

async function assertAuditDataCleaned() {
  const counts = {
    products: Number(sql(`select count(*) from public.products where sku like ${quote(`${AUDIT_PREFIX}%`)};`)),
    variants: Number(sql(`select count(*) from public.product_variants where variant_sku like ${quote(`${AUDIT_PREFIX}%`)};`)),
    operations: sql("select to_regclass('public.product_operations') is not null;") === "t"
      ? Number(sql(`select count(*) from public.product_operations where client_request_id like ${quote(`${AUDIT_PREFIX}%`)};`))
      : -1,
  };
  assert.deepEqual(counts, { products: 0, variants: 0, operations: 0 });
}

async function prepareFeatureConfig() {
  const { data, error } = await supabase.from("feature_settings").select("plan, features, updated_by").eq("id", 1).single();
  if (error) throw error;
  const features = { ...data.features, product_management: true, inventory: true, staff_accounts: true };
  const { error: updateError } = await supabase.from("feature_settings")
    .update({ plan: "custom", features, updated_by: CREATED_BY }).eq("id", 1);
  if (updateError) throw updateError;
  return data;
}

function setRpcExecute(signature, granted) {
  sql(`${granted ? "grant" : "revoke"} execute on function ${signature} ${granted ? "to" : "from"} service_role;`);
}

function installFaultHarness() {
  sql(`
    drop schema if exists audit_product_test cascade;
    create schema audit_product_test;
    create table audit_product_test.config(stage text not null, request_id text not null);

    create function audit_product_test.fail_selected_stage() returns trigger
    language plpgsql security definer set search_path = pg_catalog, public, audit_product_test as $$
    declare c audit_product_test.config%rowtype;
    declare row_json jsonb := to_jsonb(new);
    begin
      select * into c from audit_product_test.config limit 1;
      if not found then return new; end if;

      if tg_table_name = 'products'
         and c.stage = (case when tg_op = 'INSERT' then 'product_insert' else 'product_update' end)
         and coalesce(row_json->>'sku', '') like '${AUDIT_PREFIX}%'
      then raise exception 'AUDIT_PRODUCT_FAULT:%', c.stage; end if;

      if tg_table_name = 'product_variants'
         and c.stage = 'variant_write'
         and coalesce(row_json->>'variant_sku', '') like '${AUDIT_PREFIX}%'
      then raise exception 'AUDIT_PRODUCT_FAULT:variant_write'; end if;

      if tg_table_name = 'inventory_balances'
         and c.stage = 'balance_write'
         and exists (
           select 1 from public.product_variants v join public.products p on p.id = v.product_id
           where v.id = (row_json->>'variant_id')::uuid and p.sku like '${AUDIT_PREFIX}%'
         )
      then raise exception 'AUDIT_PRODUCT_FAULT:balance_write'; end if;

      if tg_table_name = 'stock_movements'
         and c.stage = 'movement_write'
         and exists (
           select 1 from public.product_variants v join public.products p on p.id = v.product_id
           where v.id = (row_json->>'variant_id')::uuid and p.sku like '${AUDIT_PREFIX}%'
         )
      then raise exception 'AUDIT_PRODUCT_FAULT:movement_write'; end if;

      if tg_table_name = 'product_operations'
         and c.stage = 'operation_record'
         and coalesce(row_json->>'client_request_id', '') = c.request_id
      then raise exception 'AUDIT_PRODUCT_FAULT:operation_record'; end if;

      return new;
    end;
    $$;

    create trigger audit_product_fail_products before insert or update on public.products
    for each row execute function audit_product_test.fail_selected_stage();
    create trigger audit_product_fail_variants before insert or update on public.product_variants
    for each row execute function audit_product_test.fail_selected_stage();
    create trigger audit_product_fail_balances before insert or update on public.inventory_balances
    for each row execute function audit_product_test.fail_selected_stage();
    create trigger audit_product_fail_movements before insert on public.stock_movements
    for each row execute function audit_product_test.fail_selected_stage();
    create trigger audit_product_fail_operations before insert or update on public.product_operations
    for each row execute function audit_product_test.fail_selected_stage();
  `);
}

function selectFault(stage, requestId) {
  sql(`truncate audit_product_test.config; insert into audit_product_test.config values (${quote(stage)}, ${quote(requestId)});`);
}

function clearFault() {
  sql("truncate audit_product_test.config;");
}

function uninstallFaultHarness() {
  sql(`
    drop trigger if exists audit_product_fail_products on public.products;
    drop trigger if exists audit_product_fail_variants on public.product_variants;
    drop trigger if exists audit_product_fail_balances on public.inventory_balances;
    drop trigger if exists audit_product_fail_movements on public.stock_movements;
    do $$ begin
      if to_regclass('public.product_operations') is not null then
        execute 'drop trigger if exists audit_product_fail_operations on public.product_operations';
      end if;
    end $$;
    drop schema if exists audit_product_test cascade;
  `);
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
      USE_PRODUCT_RPC: "true",
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

function containsProductId(value, productId) {
  if (Array.isArray(value)) return value.some((item) => containsProductId(item, productId));
  if (value && typeof value === "object") {
    if (Number(value.product_id) === Number(productId)) return true;
    return Object.values(value).some((item) => containsProductId(item, productId));
  }
  return false;
}

function authoritativeVariants(product) {
  assert.ok(Array.isArray(product.variants), "GET product must expose variants");
  return product.variants
    .filter((variant) => variant.active !== false)
    .map((variant, index) => ({
      id: variant.id,
      variant_sku: variant.variant_sku,
      barcode: variant.barcode || "",
      size: normalizedSize(variant.size),
      color: variant.color || "",
      quantity: Number(variant.quantity_on_hand ?? variant.quantity ?? 0),
      expected_on_hand: Number(variant.quantity_on_hand ?? variant.quantity ?? 0),
      price: variant.price === null || variant.price === undefined ? Number(product.price) : Number(variant.price),
      cost_price: variant.cost_price === null || variant.cost_price === undefined ? null : Number(variant.cost_price),
      supplier_id: variant.supplier_id || null,
      supplier_sku: variant.supplier_sku || "",
      reorder_level: variant.reorder_level === null || variant.reorder_level === undefined
        ? null
        : Number(variant.reorder_level),
      active: true,
      sort_order: Number(variant.sort_order ?? index),
    }));
}

function variantBySize(product, size) {
  return product.variants.find((variant) => normalizedSize(variant.size) === normalizedSize(size));
}

let server;
let previousFeature;
try {
  await cleanupAuditData();
  previousFeature = await prepareFeatureConfig();
  server = await startApp();

  await runCase("product transaction RPC health is ready", async () => {
    const { data, error } = await supabase.rpc("product_runtime_health_rpc");
    if (error) throw error;
    assert.equal(data?.ready, true, JSON.stringify(data));
    assert.equal(data?.create_rpc_ready, true, JSON.stringify(data));
    assert.equal(data?.update_rpc_ready, true, JSON.stringify(data));
  });

  await runCase("multi-size create commits product variants balances movements and projections", async () => {
    const payload = productPayload("MULTI", [
      { size: "S", quantity: 2, supplier_sku: "SUP-MULTI-S", cost_price: 7.25, reorder_level: 1 },
      { size: "M", quantity: 3, supplier_sku: "SUP-MULTI-M", cost_price: 7.5, reorder_level: 2 },
    ]);
    const { product, requestId } = await createProductOrThrow(payload);
    assert.equal(product.variants.length, 2);
    assert.deepEqual(product.variants.map((variant) => normalizedSize(variant.size)), ["S", "M"]);
    assert.deepEqual(product.variants.map((variant) => Number(variant.quantity_on_hand)), [2, 3]);

    const state = await assertProjection(product.id);
    assert.equal(Number(state.product.stock), 5);
    assert.deepEqual(state.product.size_stock, { S: 2, M: 3 });
    assert.equal(state.variants.length, 2);
    assert.equal(state.balances.length, 2);
    assert.equal(state.movements.length, 2);
    assert.deepEqual(state.movements.map((movement) => Number(movement.quantity_before)), [0, 0]);
    assert.deepEqual(state.movements.map((movement) => Number(movement.quantity_delta)).sort((a, b) => a - b), [2, 3]);
    assert.ok(state.movements.every((movement) => movement.created_by && movement.created_by !== "admin"));
    assert.equal((await operationsForRequest(requestId)).length, 1);

    const fromGet = await getProductBySku(payload.sku);
    assert.ok(fromGet);
    assert.ok(Number.isInteger(Number(fromGet.metadata_version)));
    assert.ok(Number.isInteger(Number(fromGet.structure_version)));
    assert.equal(fromGet.variants.length, 2);
    assert.equal(variantBySize(fromGet, "S").supplier_sku, "SUP-MULTI-S");
  });

  await runCase("ONE SIZE create makes exactly one stable variant and balance", async () => {
    const payload = productPayload("ONE-SIZE", [{ size: "ONE SIZE", quantity: 4 }], { size_system: "one_size" });
    const { product } = await createProductOrThrow(payload);
    const state = await assertProjection(product.id);
    assert.equal(state.variants.length, 1);
    assert.equal(normalizedSize(state.variants[0].size), "ONE SIZE");
    assert.equal(state.balances.length, 1);
    assert.equal(Number(state.balances[0].quantity_on_hand), 4);
    assert.equal(state.movements.length, 1);
    assert.equal(Number(state.movements[0].quantity_delta), 4);
  });

  await runCase("zero-stock create makes balances without fake positive movements", async () => {
    const payload = productPayload("ZERO", [
      { size: "XS", quantity: 0 },
      { size: "S", quantity: 0 },
    ]);
    const { product } = await createProductOrThrow(payload);
    const state = await assertProjection(product.id);
    assert.equal(state.variants.length, 2);
    assert.equal(state.balances.length, 2);
    assert.ok(state.balances.every((row) => Number(row.quantity_on_hand) === 0));
    assert.equal(state.movements.length, 0);
    assert.equal(Number(state.product.stock), 0);
    assert.deepEqual(state.product.size_stock, { XS: 0, S: 0 });
  });

  await runCase("20 different IDs racing on one SKU create one product", async () => {
    const payload = productPayload("SKU-RACE", [{ size: "S", quantity: 1 }]);
    const requestIds = Array.from({ length: 20 }, (_, index) => auditId(`SKU-RACE-${index}`));
    const responses = await Promise.all(requestIds.map((requestId) => createProduct(payload, requestId)));
    assert.equal(responses.filter((response) => response.status === 201).length, 1, JSON.stringify(responses));
    assert.equal(responses.filter((response) => response.status === 409).length, 19, JSON.stringify(responses));
    const product = await databaseProduct(payload.sku);
    assert.ok(product);
    assert.equal(Number(sql(`select count(*) from public.products where sku = ${quote(payload.sku)};`)), 1);
    assert.equal((await variantsForProduct(product.id)).length, 1);
    assert.equal((await operationsForProduct(product.id)).length, 1);
    await assertProjection(product.id);
  });

  await runCase("20 concurrent replays of one create ID return one business result", async () => {
    const payload = productPayload("CREATE-REPLAY", [{ size: "S", quantity: 2 }]);
    const requestId = auditId("CREATE-REPLAY");
    const responses = await Promise.all(Array.from({ length: 20 }, () => createProduct(payload, requestId)));
    assert.ok(responses.every((response) => response.status === 200 || response.status === 201), JSON.stringify(responses));
    const productIds = new Set(responses.map((response) => Number(responseProduct(response)?.id)));
    assert.equal(productIds.size, 1);
    assert.ok(!productIds.has(NaN));
    assert.equal(Number(sql(`select count(*) from public.products where sku = ${quote(payload.sku)};`)), 1);
    assert.equal((await operationsForRequest(requestId)).length, 1);
    const product = await databaseProduct(payload.sku);
    assert.equal((await movementsForProduct(product.id)).length, 1);
    assert.equal(Number((await balancesForProduct(product.id))[0].quantity_on_hand), 2);
  });

  await runCase("same create ID with a different fingerprint is rejected without writes", async () => {
    const payload = productPayload("CREATE-FINGERPRINT", [{ size: "S", quantity: 1 }]);
    const requestId = auditId("CREATE-FINGERPRINT");
    const first = await createProduct(payload, requestId);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const product = responseProduct(first);
    const before = await stateForProduct(product.id);
    const conflict = await createProduct({ ...payload, price: 99.99 }, requestId);
    assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
    assert.equal(conflict.data.code, "PRODUCT_OPERATION_CONFLICT");
    assert.deepEqual(await stateForProduct(product.id), before);
    assert.equal((await operationsForRequest(requestId)).length, 1);
  });

  await runCase("product write permission matrix returns 401 or 403 and writes nothing", async () => {
    for (const role of [undefined, "staff", "inventory", "readonly"]) {
      const payload = productPayload(`PERMISSION-${role || "ANON"}`, [{ size: "S", quantity: 1 }]);
      const requestId = auditId(`PERMISSION-${role || "ANON"}`);
      const response = await createProduct(payload, requestId, role ? { role } : {});
      assert.equal(response.status, role ? 403 : 401, `${role || "anonymous"}: ${JSON.stringify(response.data)}`);
      await assertNoProductWrites(payload.sku, requestId);
    }
    const readable = await getProducts("readonly");
    assert.ok(Array.isArray(readable));
  });

  await runCase("missing create RPC execute permission fails closed with no writes", async () => {
    const payload = productPayload("CREATE-REVOKE", [{ size: "S", quantity: 2 }]);
    const requestId = auditId("CREATE-REVOKE");
    setRpcExecute(PRODUCT_CREATE_SIGNATURE, false);
    try {
      const response = await createProduct(payload, requestId);
      assert.equal(response.status, 503, JSON.stringify(response.data));
      await assertNoProductWrites(payload.sku, requestId);
    } finally {
      setRpcExecute(PRODUCT_CREATE_SIGNATURE, true);
    }
  });

  await runCase("metadata-only edit ignores stale legacy stock fields", async () => {
    const payload = productPayload("METADATA", [
      { size: "S", quantity: 2 },
      { size: "M", quantity: 3 },
    ]);
    const { product } = await createProductOrThrow(payload);
    const before = await stateForProduct(product.id);
    const response = await updateProduct(product, auditId("METADATA"), {
      name_en: "Metadata only changed",
      stock: 999,
      sizes: "FAKE",
      size_stock: { FAKE: 999 },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const updated = responseProduct(response);
    assert.equal(updated.name_en, "Metadata only changed");
    assert.equal(Number(updated.metadata_version), Number(product.metadata_version) + 1);
    assert.equal(Number(updated.structure_version), Number(product.structure_version));
    const after = await stateForProduct(product.id);
    assert.deepEqual(inventorySlice(after), inventorySlice(before));
    assert.equal(after.product.name_en, "Metadata only changed");
  });

  await runCase("stale metadata and structure versions return 409 without partial writes", async () => {
    const payload = productPayload("VERSIONS", [{ size: "S", quantity: 0 }]);
    const { product } = await createProductOrThrow(payload);
    const firstMetadata = await updateProduct(product, auditId("VERSION-META-1"), { name_en: "First writer" });
    assert.equal(firstMetadata.status, 200, JSON.stringify(firstMetadata.data));
    const staleMetadata = await updateProduct(product, auditId("VERSION-META-STALE"), { name_en: "Stale writer" });
    assert.equal(staleMetadata.status, 409, JSON.stringify(staleMetadata.data));
    assert.equal(staleMetadata.data.code, "PRODUCT_VERSION_CONFLICT");
    let current = await getProductBySku(payload.sku);
    assert.equal(current.name_en, "First writer");

    const baseForStructure = current;
    const addM = authoritativeVariants(baseForStructure).concat(variantInput(payload.sku, "M", 0, { sort_order: 1 }));
    const firstStructure = await updateProduct(baseForStructure, auditId("VERSION-STRUCTURE-1"), {}, addM);
    assert.equal(firstStructure.status, 200, JSON.stringify(firstStructure.data));
    const staleAddL = authoritativeVariants(baseForStructure).concat(variantInput(payload.sku, "L", 0, { sort_order: 1 }));
    const staleStructure = await updateProduct(baseForStructure, auditId("VERSION-STRUCTURE-STALE"), {}, staleAddL);
    assert.equal(staleStructure.status, 409, JSON.stringify(staleStructure.data));
    assert.equal(staleStructure.data.code, "PRODUCT_VERSION_CONFLICT");
    current = await getProductBySku(payload.sku);
    assert.ok(variantBySize(current, "M"));
    assert.equal(variantBySize(current, "L"), undefined);
  });

  await runCase("update ID replays once and rejects a different fingerprint", async () => {
    const payload = productPayload("UPDATE-REPLAY", [{ size: "S", quantity: 0 }]);
    const { product } = await createProductOrThrow(payload);
    const requestId = auditId("UPDATE-REPLAY");
    const responses = await Promise.all(Array.from({ length: 20 }, () =>
      updateProduct(product, requestId, { name_en: "One update result" })));
    assert.ok(responses.every((response) => response.status === 200), JSON.stringify(responses));
    assert.equal(new Set(responses.map((response) => Number(responseProduct(response)?.metadata_version))).size, 1);
    assert.equal((await operationsForRequest(requestId)).length, 1);

    const conflict = await updateProduct(product, requestId, { name_en: "Different payload" });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
    assert.equal(conflict.data.code, "PRODUCT_OPERATION_CONFLICT");
    assert.equal((await databaseProduct(payload.sku)).name_en, "One update result");
  });

  await runCase("stale expected_on_hand cannot overwrite a newer inventory adjustment", async () => {
    const payload = productPayload("STALE-STOCK", [{ size: "S", quantity: 1 }]);
    const { product } = await createProductOrThrow(payload);
    const staleVariants = authoritativeVariants(product).map((variant) => ({ ...variant, quantity: 5 }));
    const adjustment = await adjust(variantBySize(product, "S").id, auditId("STALE-STOCK-ADJUST"), 1);
    assert.equal(adjustment.status, 200, JSON.stringify(adjustment.data));
    const before = await stateForProduct(product.id);
    const stale = await updateProduct(product, auditId("STALE-STOCK-UPDATE"), {}, staleVariants);
    assert.equal(stale.status, 409, JSON.stringify(stale.data));
    assert.equal(stale.data.code, "PRODUCT_STOCK_CONFLICT");
    assert.deepEqual(await stateForProduct(product.id), before);
    assert.equal(Number((await balancesForProduct(product.id))[0].quantity_on_hand), 2);
  });

  await runCase("missing update RPC execute permission fails closed", async () => {
    const payload = productPayload("UPDATE-REVOKE", [{ size: "S", quantity: 1 }]);
    const { product } = await createProductOrThrow(payload);
    const before = await stateForProduct(product.id);
    setRpcExecute(PRODUCT_UPDATE_SIGNATURE, false);
    try {
      const response = await updateProduct(product, auditId("UPDATE-REVOKE"), { name_en: "Must not persist" });
      assert.equal(response.status, 503, JSON.stringify(response.data));
      assert.deepEqual(await stateForProduct(product.id), before);
    } finally {
      setRpcExecute(PRODUCT_UPDATE_SIGNATURE, true);
    }
  });

  await runCase("add disable and restore Variant preserves stable IDs and history", async () => {
    const payload = productPayload("LIFECYCLE", [
      { size: "S", quantity: 2 },
      { size: "M", quantity: 1 },
    ]);
    let { product } = await createProductOrThrow(payload);
    const originalM = variantBySize(product, "M");
    assert.ok(originalM?.id);
    const reduce = await adjust(originalM.id, auditId("LIFECYCLE-M-TO-ZERO"), -1);
    assert.equal(reduce.status, 200, JSON.stringify(reduce.data));
    product = await getProductBySku(payload.sku);

    const withL = authoritativeVariants(product).concat(variantInput(payload.sku, "L", 2, { sort_order: 2 }));
    let response = await updateProduct(product, auditId("LIFECYCLE-ADD-L"), {}, withL);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    product = responseProduct(response);
    const addedL = variantBySize(product, "L");
    assert.ok(addedL?.id);
    assert.equal(Number(addedL.quantity_on_hand), 2);
    assert.equal(variantBySize(product, "M").id, originalM.id);

    const beforeDisableHistory = (await movementsForProduct(product.id)).filter((movement) => movement.variant_id === originalM.id);
    const withoutM = authoritativeVariants(product).filter((variant) => variant.size !== "M");
    response = await updateProduct(product, auditId("LIFECYCLE-DISABLE-M"), {}, withoutM);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    product = responseProduct(response);
    const databaseM = (await variantsForProduct(product.id)).find((variant) => variant.id === originalM.id);
    assert.equal(databaseM.active, false);
    assert.equal(Number((await balancesForProduct(product.id)).find((row) => row.variant_id === originalM.id).quantity_on_hand), 0);
    assert.equal(
      (await movementsForProduct(product.id)).filter((movement) => movement.variant_id === originalM.id).length,
      beforeDisableHistory.length,
    );

    const restoreM = authoritativeVariants(product).concat({
      ...variantInput(payload.sku, "M", 0, { variant_sku: originalM.variant_sku, barcode: originalM.barcode, sort_order: 1 }),
      id: originalM.id,
      expected_on_hand: 0,
    });
    response = await updateProduct(product, auditId("LIFECYCLE-RESTORE-M"), {}, restoreM);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    product = responseProduct(response);
    assert.equal(variantBySize(product, "M").id, originalM.id);
    assert.equal(variantBySize(product, "M").active, true);
    await assertProjection(product.id);
  });

  await runCase("positive-stock Variant cannot be omitted from authoritative catalog", async () => {
    const payload = productPayload("BLOCK-STOCK", [
      { size: "S", quantity: 2 },
      { size: "M", quantity: 0 },
    ]);
    const { product } = await createProductOrThrow(payload);
    const before = await stateForProduct(product.id);
    const onlyM = authoritativeVariants(product).filter((variant) => variant.size === "M");
    const response = await updateProduct(product, auditId("BLOCK-STOCK"), {}, onlyM);
    assert.equal(response.status, 409, JSON.stringify(response.data));
    assert.equal(response.data.code, "PRODUCT_VARIANT_DEACTIVATION_BLOCKED");
    assert.deepEqual(await stateForProduct(product.id), before);
  });

  await runCase("reserved Variant cannot be omitted from authoritative catalog", async () => {
    const payload = productPayload("BLOCK-RESERVED", [
      { size: "S", quantity: 0 },
      { size: "M", quantity: 1 },
    ]);
    const { product } = await createProductOrThrow(payload);
    const reservedVariant = variantBySize(product, "M");
    const { error } = await supabase.from("inventory_balances")
      .update({ quantity_reserved: 1 })
      .eq("variant_id", reservedVariant.id);
    if (error) throw error;
    const refreshed = await getProductBySku(payload.sku);
    const before = await stateForProduct(product.id);
    const onlyS = authoritativeVariants(refreshed).filter((variant) => variant.size === "S");
    const response = await updateProduct(refreshed, auditId("BLOCK-RESERVED"), {}, onlyS);
    assert.equal(response.status, 409, JSON.stringify(response.data));
    assert.equal(response.data.code, "PRODUCT_VARIANT_DEACTIVATION_BLOCKED");
    assert.deepEqual(await stateForProduct(product.id), before);
  });

  await runCase("metadata edit and 20 inventory adjustments do not lose stock", async () => {
    const payload = productPayload("INVENTORY-RACE", [{ size: "ONE SIZE", quantity: 0 }], { size_system: "one_size" });
    const { product } = await createProductOrThrow(payload);
    const variant = variantBySize(product, "ONE SIZE");
    const adjustmentPromises = Array.from({ length: 20 }, (_, index) =>
      adjust(variant.id, auditId(`INVENTORY-RACE-${index}`), 1));
    const metadataPromise = updateProduct(product, auditId("INVENTORY-RACE-METADATA"), {
      name_en: "Concurrent metadata survived",
      stock: 0,
      size_stock: { "ONE SIZE": 0 },
    });
    const [metadata, ...adjustments] = await Promise.all([metadataPromise, ...adjustmentPromises]);
    assert.equal(metadata.status, 200, JSON.stringify(metadata.data));
    assert.ok(adjustments.every((response) => response.status === 200), JSON.stringify(adjustments));
    const state = await assertProjection(product.id);
    assert.equal(state.product.name_en, "Concurrent metadata survived");
    assert.equal(Number(state.product.stock), 20);
    assert.deepEqual(state.product.size_stock, { "ONE SIZE": 20 });
    assert.equal(Number(state.balances[0].quantity_on_hand), 20);
    assert.equal(state.movements.filter((movement) => movement.source_type === "admin_inventory_adjustment").length, 20);
  });

  for (const stage of ["product_insert", "variant_write", "balance_write", "movement_write", "operation_record"]) {
    await runCase(`create ${stage} fault rolls every business table back`, async () => {
      const payload = productPayload(`CREATE-FAULT-${stage}`, [{ size: "S", quantity: 2 }]);
      const requestId = auditId(`CREATE-FAULT-${stage}`);
      installFaultHarness();
      try {
        selectFault(stage, requestId);
        const response = await createProduct(payload, requestId);
        assert.equal(response.status, 503, JSON.stringify(response.data));
        await assertNoProductWrites(payload.sku, requestId);
      } finally {
        uninstallFaultHarness();
      }
    });
  }

  for (const stage of ["product_update", "variant_write", "balance_write", "movement_write", "operation_record"]) {
    await runCase(`update ${stage} fault rolls metadata Variant balance movement and operation back`, async () => {
      const payload = productPayload(`UPDATE-FAULT-${stage}`, [{ size: "S", quantity: 1 }]);
      const { product } = await createProductOrThrow(payload);
      const before = await stateForProduct(product.id);
      const requestId = auditId(`UPDATE-FAULT-${stage}`);
      const changedVariants = authoritativeVariants(product).map((variant) => ({
        ...variant,
        quantity: 3,
        supplier_sku: `FAULT-${stage}`,
      }));
      installFaultHarness();
      try {
        selectFault(stage, requestId);
        const response = await updateProduct(product, requestId, { name_en: `Fault ${stage}` }, changedVariants);
        assert.equal(response.status, 503, JSON.stringify(response.data));
        assert.deepEqual(await stateForProduct(product.id), before);
        assert.equal((await operationsForRequest(requestId)).length, 0);
      } finally {
        uninstallFaultHarness();
      }
    });
  }

  await runCase("product reconciliation reports and clears a legacy projection mismatch", async () => {
    const payload = productPayload("RECONCILIATION", [{ size: "S", quantity: 2 }]);
    const { product } = await createProductOrThrow(payload);
    const { data: healthyBefore, error: beforeError } = await supabase.rpc("product_reconciliation_rpc");
    if (beforeError) throw beforeError;
    for (const field of [
      "projectionMismatches",
      "productsMissingVariants",
      "variantsMissingMainStoreBalances",
      "inactiveVariantsWithReserved",
      "hardenedProductsMissingCreateOperation",
      "initialMovementMismatches",
    ]) assert.ok(Array.isArray(healthyBefore?.[field]), `missing reconciliation field ${field}`);
    assert.equal(healthyBefore.projectionMismatches.some((item) => Number(item.product_id) === Number(product.id)), false);

    const { error: corruptError } = await supabase.from("products")
      .update({ stock: 999, size_stock: { S: 999 } })
      .eq("id", product.id);
    if (corruptError) throw corruptError;
    const { data: broken, error: brokenError } = await supabase.rpc("product_reconciliation_rpc");
    if (brokenError) throw brokenError;
    assert.equal(broken.healthy, false, JSON.stringify(broken));
    assert.ok(containsProductId(broken.projectionMismatches, product.id), JSON.stringify(broken));

    const { error: restoreError } = await supabase.from("products")
      .update({ stock: 2, sizes: "S", size_stock: { S: 2 } })
      .eq("id", product.id);
    if (restoreError) throw restoreError;
    const { data: restored, error: restoredError } = await supabase.rpc("product_reconciliation_rpc");
    if (restoredError) throw restoredError;
    assert.equal(restored.projectionMismatches.some((item) => Number(item.product_id) === Number(product.id)), false);
  });
} finally {
  await stopApp(server);
  try { uninstallFaultHarness(); } catch {}
  try { setRpcExecute(PRODUCT_CREATE_SIGNATURE, true); } catch {}
  try { setRpcExecute(PRODUCT_UPDATE_SIGNATURE, true); } catch {}
  try { await cleanupAuditData(); } catch (error) {
    results.push({ name: "final audit cleanup", ok: false, error });
  }
  if (previousFeature) {
    try { await supabase.from("feature_settings").update(previousFeature).eq("id", 1); } catch (error) {
      results.push({ name: "restore feature settings", ok: false, error });
    }
  }
}

await runCase("product transaction test data is fully cleaned", assertAuditDataCleaned);

const failures = results.filter((result) => !result.ok);
console.log(`\nProduct transaction integration: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length > 0) {
  console.error(`Failed cases: ${failures.map((failure) => failure.name).join(", ")}`);
  process.exitCode = 1;
}
