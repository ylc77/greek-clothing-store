import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3317;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const DB_CONTAINER = "supabase_db_clothing_web";
const PREFIX = "AUDIT-STORAGE-";
const PASSWORDS = {
  owner: "AuditStorageOwner!2026-Alpha",
  staff: "AuditStorageStaff!2026-Bravo",
  inventory: "AuditStorageInventory!2026-Charlie",
  readonly: "AuditStorageReadonly!2026-Delta",
  developer: `Storage-Test-${randomUUID()}!9`,
};
const AUTH_RATE_LIMIT_SECRET = "test-only-storage-auth-rate-limit-secret-2026";
const results = [];
const objectPaths = new Set();
let server;
let authUserId = "";
let previousFeature;
let previousLogo = "";
let previousCategoryImage = "";
let categoryId = "";

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: options.env || process.env,
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) {
    if (options.sensitiveOutput) throw new Error(`${name} failed; sensitive output was intentionally suppressed.`);
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || ""}`);
  }
  return String(result.stdout || "").trim();
}

function sql(statement) {
  return command("docker", [
    "exec", "-i", DB_CONTAINER,
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: statement });
}

function storageSql(statement) {
  return command("docker", [
    "exec", "-i", "-e", "PGPASSWORD=postgres", DB_CONTAINER,
    "psql", "-h", "127.0.0.1", "-U", "supabase_storage_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: statement });
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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
  assert.ok(values.ANON_KEY && values.SERVICE_ROLE_KEY);
  return values;
}

function redactLogs(value, local) {
  let output = String(value || "");
  for (const secret of [local.SERVICE_ROLE_KEY, local.ANON_KEY, PASSWORDS.developer]) {
    if (secret) output = output.replaceAll(secret, "[redacted]");
  }
  return output.slice(-5000);
}

async function startApp(local) {
  fs.rmSync(path.join(ROOT, ".next", "cache"), { recursive: true, force: true });
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
      AUTH_RATE_LIMIT_SECRET,
      USE_POS_RPC: "true",
      USE_PRODUCT_RPC: "true",
      USE_CSV_IMPORT_RPC: "true",
      OPENAI_API_KEY: "",
      SERVER_IMAGE_FETCH_ALLOWED_ORIGINS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev exited early\n${redactLogs(logs.join(""), local)}`);
    try {
      const response = await fetch(`${APP_URL}/admin`);
      if (response.status < 500) return { child, logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopApp({ child });
  throw new Error(`Timed out waiting for Next dev\n${redactLogs(logs.join(""), local)}`);
}

async function stopApp(current) {
  if (!current?.child || current.child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(current.child.pid), "/t", "/f"], { stdio: "ignore" });
  else current.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 750));
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.role) headers["x-admin-password"] = PASSWORDS[options.role];
  let body = options.body;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`${APP_URL}${pathname}`, {
    method: options.method || (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
  return { status: response.status, data, headers: response.headers };
}

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

function storagePath(url) {
  const marker = "/storage/v1/object/public/product-images/";
  const parsed = new URL(url);
  const index = parsed.pathname.indexOf(marker);
  assert.notEqual(index, -1);
  return decodeURIComponent(parsed.pathname.slice(index + marker.length));
}

function productPrefix(productId, sku) {
  const readable = sku.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "sku";
  const digest = createHash("sha256").update(sku, "utf8").digest("hex").slice(0, 12);
  return `products/${productId}/${readable}-${digest}`;
}

async function imageForm(buffer, name, type, sku = "", mode = "") {
  const form = new FormData();
  form.append("images", new Blob([buffer], { type }), name);
  if (sku) form.append("sku", sku);
  if (mode) form.append("mode", mode);
  return form;
}

async function singleImageForm(buffer, type, extraName = false) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), "upload.png");
  if (extraName) form.append("name", "logo");
  return form;
}

async function createProduct(service, suffix, stock = 0) {
  const sku = `${PREFIX}${suffix}-${randomUUID()}`;
  const { data, error } = await service.from("products").insert({
    sku, name_cn: "存储测试商品", name_en: "Storage Test", name_gr: "Storage Test",
    category: "women", subcategory: "dresses", price: 19.9, stock,
  }).select("id,sku,image_url,image_urls").single();
  if (error) throw error;
  return data;
}

async function bootstrapDeveloper(local) {
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  };
  command(process.execPath, [
    "--experimental-strip-types", "scripts/developer-credentials.ts", "bootstrap",
    "--project-ref", "clothing-web-storage-test", "--yes", "--password-stdin", "--no-show-password", "--test-local",
  ], { input: `${PASSWORDS.developer}\n`, sensitiveOutput: true, env });
}

async function developerCookie() {
  const response = await request("/api/admin/developer-session", {
    json: { password: PASSWORDS.developer },
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";", 1)[0];
  assert.match(cookie, /^clothing_developer_settings=/);
  return cookie;
}

function createProductUpdateFailureTrigger(sku) {
  sql(`
    create or replace function public.audit_storage_fail_product_image_update()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.sku = ${quote(sku)} and new.image_url is distinct from old.image_url then
        raise exception 'AUDIT_STORAGE_DB_FAILURE';
      end if;
      return new;
    end;
    $$;
    drop trigger if exists audit_storage_fail_product_image_update on public.products;
    create trigger audit_storage_fail_product_image_update
    before update on public.products for each row
    execute function public.audit_storage_fail_product_image_update();
  `);
}

function dropProductUpdateFailureTrigger() {
  sql(`
    drop trigger if exists audit_storage_fail_product_image_update on public.products;
    drop function if exists public.audit_storage_fail_product_image_update();
  `);
}

function createStorageDeleteFailureTrigger(pathValue) {
  storageSql(`
    create or replace function storage.audit_storage_fail_object_delete()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if old.bucket_id = 'product-images' and old.name = ${quote(pathValue)} then
        raise exception 'AUDIT_STORAGE_DELETE_FAILURE';
      end if;
      return old;
    end;
    $$;
    drop trigger if exists audit_storage_fail_object_delete on storage.objects;
    create trigger audit_storage_fail_object_delete
    before delete on storage.objects for each row
    execute function storage.audit_storage_fail_object_delete();
  `);
}

function dropStorageDeleteFailureTrigger() {
  storageSql(`
    drop trigger if exists audit_storage_fail_object_delete on storage.objects;
    drop function if exists storage.audit_storage_fail_object_delete();
  `);
}

const local = readLocalEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const validJpeg = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#446688" } }).jpeg().toBuffer();
const validPng = await sharp({ create: { width: 160, height: 120, channels: 4, background: "#885544" } }).png().toBuffer();
const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

try {
  sql(`delete from public.storage_object_operations where owner_key like ${quote(`${PREFIX}%`)}; delete from public.product_delete_operations where sku_snapshot like ${quote(`${PREFIX}%`)}; delete from public.developer_access;`);
  const { data: feature, error: featureError } = await service.from("feature_settings").select("plan,features,updated_by").eq("id", 1).single();
  if (featureError) throw featureError;
  previousFeature = feature;
  const { error: featureUpdateError } = await service.from("feature_settings").update({
    plan: "custom",
    features: { ...feature.features, product_management: true, staff_accounts: true, ai_tools: true },
    updated_by: "storage-integration-test",
  }).eq("id", 1);
  if (featureUpdateError) throw featureUpdateError;

  const { data: settings, error: settingsError } = await service.from("business_settings").select("logo_url").limit(1).single();
  if (settingsError) throw settingsError;
  previousLogo = settings.logo_url || "";
  const { data: category, error: categoryError } = await service.from("product_categories").select("id,image_url").order("sort_order").limit(1).single();
  if (categoryError) throw categoryError;
  categoryId = category.id;
  previousCategoryImage = category.image_url || "";

  await bootstrapDeveloper(local);
  server = await startApp(local);
  const devCookie = await developerCookie();

  await runCase("bucket constraints and private operation tables are installed", async () => {
    const bucket = JSON.parse(sql(`select json_build_object('public', public, 'limit', file_size_limit, 'mimes', allowed_mime_types) from storage.buckets where id='product-images';`));
    assert.equal(bucket.public, true);
    assert.equal(Number(bucket.limit), 10 * 1024 * 1024);
    assert.deepEqual(new Set(bucket.mimes), new Set(["image/jpeg", "image/png", "image/webp"]));
    assert.equal(Number(sql(`select count(*) from pg_policies where schemaname='public' and tablename in ('storage_object_operations','product_delete_operations');`)), 0);
    assert.equal(Number(sql(`select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('storage_object_operations','product_delete_operations') and grantee in ('anon','authenticated');`)), 0);
  });

  await runCase("anonymous and authenticated clients cannot write Storage", async () => {
    const anonPath = `audit/${PREFIX.toLowerCase()}anon-${randomUUID()}.webp`;
    const anonUpload = await anon.storage.from("product-images").upload(anonPath, validPng, { contentType: "image/webp" });
    assert.ok(anonUpload.error);

    const email = `storage-${randomUUID()}@example.test`;
    const password = `Storage-Auth-${randomUUID()}!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error || new Error("auth fixture missing");
    authUserId = created.data.user.id;
    const authenticated = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await authenticated.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    const authPath = `audit/${PREFIX.toLowerCase()}auth-${randomUUID()}.webp`;
    const authUpload = await authenticated.storage.from("product-images").upload(authPath, validPng, { contentType: "image/webp" });
    assert.ok(authUpload.error);
    assert.equal(Number(sql(`select count(*) from storage.objects where name in (${quote(anonPath)},${quote(authPath)});`)), 0);
  });

  await runCase("fake MIME and SVG/script payloads are rejected before Storage writes", async () => {
    const product = await createProduct(service, "FAKE-MIME");
    const beforeObjects = Number(sql(`select count(*) from storage.objects where name like ${quote(`${productPrefix(product.id, product.sku)}%`)};`));
    const response = await request("/api/admin/images", {
      role: "owner",
      body: await imageForm(svgPayload, `${product.sku}.png`, "image/png", product.sku, "main"),
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.failureCount, 1);
    assert.equal(response.data.successCount, 0);
    assert.match(response.data.results[0].message, /signature|JPEG|PNG|WebP/i);
    assert.equal(Number(sql(`select count(*) from storage.objects where name like ${quote(`${productPrefix(product.id, product.sku)}%`)};`)), beforeObjects);
    const refreshed = await service.from("products").select("image_url").eq("id", product.id).single();
    assert.equal(refreshed.data?.image_url || "", "");
  });

  let uploadedProduct;
  let uploadedPath = "";
  await runCase("owner upload commits one reference and low roles cannot create an object", async () => {
    uploadedProduct = await createProduct(service, "OWNER-UPLOAD");
    for (const role of [undefined, "staff", "inventory", "readonly"]) {
      const response = await request("/api/admin/images", {
        role,
        body: await imageForm(validJpeg, `${uploadedProduct.sku}.jpg`, "image/jpeg", uploadedProduct.sku, "main"),
      });
      assert.ok(response.status === 401 || response.status === 403, `${role || "anon"}: ${response.status}`);
    }
    const owner = await request("/api/admin/images", {
      role: "owner",
      body: await imageForm(validJpeg, `${uploadedProduct.sku}.jpg`, "image/jpeg", uploadedProduct.sku, "main"),
    });
    assert.equal(owner.status, 200, JSON.stringify(owner.data));
    assert.equal(owner.data.successCount, 1);
    uploadedPath = storagePath(owner.data.results[0].imageUrl);
    objectPaths.add(uploadedPath);
    assert.ok(uploadedPath.startsWith(`${productPrefix(uploadedProduct.id, uploadedProduct.sku)}/main/`));
    const row = await service.from("products").select("image_url,image_width,image_height").eq("id", uploadedProduct.id).single();
    assert.equal(row.data?.image_url, owner.data.results[0].imageUrl);
    assert.equal(Number(row.data?.image_width), 120);
    assert.equal(Number(row.data?.image_height), 160);
    assert.equal(Number(sql(`select count(*) from public.storage_object_operations where object_path=${quote(uploadedPath)} and status='reference_committed';`)), 1);
  });

  await runCase("Storage success and database failure compensate the new object", async () => {
    const product = await createProduct(service, "DB-FAILURE");
    createProductUpdateFailureTrigger(product.sku);
    try {
      const response = await request("/api/admin/images", {
        role: "owner",
        body: await imageForm(validJpeg, `${product.sku}.jpg`, "image/jpeg", product.sku, "main"),
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.failureCount, 1);
      const operation = JSON.parse(sql(`select row_to_json(x) from (select object_path,status from public.storage_object_operations where owner_key=${quote(String(product.id))} order by created_at desc limit 1) x;`));
      assert.equal(operation.status, "compensated");
      assert.equal(Number(sql(`select count(*) from storage.objects where bucket_id='product-images' and name=${quote(operation.object_path)};`)), 0);
      const row = await service.from("products").select("image_url").eq("id", product.id).single();
      assert.equal(row.data?.image_url || "", "");
    } finally {
      dropProductUpdateFailureTrigger();
    }
  });

  await runCase("database reference removal succeeds while Storage failure remains recoverable", async () => {
    assert.ok(uploadedProduct && uploadedPath);
    createStorageDeleteFailureTrigger(uploadedPath);
    try {
      const response = await request("/api/admin/images", {
        method: "DELETE",
        role: "owner",
        json: { sku: uploadedProduct.sku, kind: "main" },
      });
      assert.equal(response.status, 202, JSON.stringify(response.data));
      assert.equal(response.data.cleanupPending, true);
      const row = await service.from("products").select("image_url").eq("id", uploadedProduct.id).single();
      assert.equal(row.data?.image_url || "", "");
      assert.equal(Number(sql(`select count(*) from storage.objects where bucket_id='product-images' and name=${quote(uploadedPath)};`)), 1);
      assert.equal(Number(sql(`select count(*) from public.storage_object_operations where object_path=${quote(uploadedPath)} and status='cleanup_pending';`)), 1);
    } finally {
      dropStorageDeleteFailureTrigger();
    }
  });

  await runCase("Store and category uploads require the right identity and commit their references", async () => {
    const ownerDenied = await request("/api/admin/settings/upload?target=logo", {
      role: "owner",
      body: await singleImageForm(validPng, "image/png"),
    });
    assert.equal(ownerDenied.status, 401);
    const strictName = await request(`/api/admin/settings/upload?target=category&categoryId=${categoryId}`, {
      role: "owner",
      body: await singleImageForm(validPng, "image/png", true),
    });
    assert.equal(strictName.status, 400);

    const logo = await request("/api/admin/settings/upload?target=logo", {
      headers: { cookie: devCookie },
      body: await singleImageForm(validPng, "image/png"),
    });
    assert.equal(logo.status, 201, JSON.stringify(logo.data));
    const logoPath = storagePath(logo.data.url);
    objectPaths.add(logoPath);
    const settings = await service.from("business_settings").select("logo_url").limit(1).single();
    assert.equal(settings.data?.logo_url, logo.data.url);

    const category = await request(`/api/admin/settings/upload?target=category&categoryId=${categoryId}`, {
      role: "owner",
      body: await singleImageForm(validPng, "image/png"),
    });
    assert.equal(category.status, 201, JSON.stringify(category.data));
    const categoryPath = storagePath(category.data.url);
    objectPaths.add(categoryPath);
    const categoryRow = await service.from("product_categories").select("image_url").eq("id", categoryId).single();
    assert.equal(categoryRow.data?.image_url, category.data.url);
  });

  await runCase("permanent delete is transactional, cleans safe objects, and blocks inventory history", async () => {
    const safe = await createProduct(service, "PERMANENT-SAFE");
    const safeVariant = await service.from("product_variants").insert({ product_id: safe.id, variant_sku: `${safe.sku}-ONE`, size: "ONE SIZE" }).select("id").single();
    if (safeVariant.error) throw safeVariant.error;
    const locationId = sql("select id from public.inventory_locations where code='MAIN_STORE';");
    const safeBalance = await service.from("inventory_balances").insert({ variant_id: safeVariant.data.id, location_id: locationId, quantity_on_hand: 0, quantity_reserved: 0 });
    if (safeBalance.error) throw safeBalance.error;
    const safePath = `${productPrefix(safe.id, safe.sku)}/main/${randomUUID()}.webp`;
    const upload = await service.storage.from("product-images").upload(safePath, validPng, { contentType: "image/webp" });
    if (upload.error) throw upload.error;
    objectPaths.add(safePath);
    const publicUrl = service.storage.from("product-images").getPublicUrl(safePath).data.publicUrl;
    const update = await service.from("products").update({ image_url: publicUrl }).eq("id", safe.id);
    if (update.error) throw update.error;
    const deleted = await request(`/api/admin/products/${safe.id}/permanent`, { method: "DELETE", role: "owner", headers: { "x-operation-id": randomUUID() } });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(Number(sql(`select count(*) from public.products where id=${safe.id};`)), 0);
    assert.equal(Number(sql(`select count(*) from storage.objects where bucket_id='product-images' and name=${quote(safePath)};`)), 0);

    const blocked = await createProduct(service, "PERMANENT-BLOCKED", 1);
    const blockedVariant = await service.from("product_variants").insert({ product_id: blocked.id, variant_sku: `${blocked.sku}-ONE`, size: "ONE SIZE" }).select("id").single();
    if (blockedVariant.error) throw blockedVariant.error;
    const balance = await service.from("inventory_balances").insert({ variant_id: blockedVariant.data.id, location_id: locationId, quantity_on_hand: 1, quantity_reserved: 0 });
    if (balance.error) throw balance.error;
    const denied = await request(`/api/admin/products/${blocked.id}/permanent`, { method: "DELETE", role: "owner", headers: { "x-operation-id": randomUUID() } });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.code, "PRODUCT_DELETE_BLOCKED");
    assert.equal(Number(sql(`select count(*) from public.products where id=${blocked.id};`)), 1);
    assert.equal(Number(denied.data.blockers.nonzeroBalances), 1);
  });
} finally {
  await stopApp(server);
  try { dropProductUpdateFailureTrigger(); } catch {}
  try { dropStorageDeleteFailureTrigger(); } catch {}
  if (previousLogo !== undefined) await service.from("business_settings").update({ logo_url: previousLogo }).neq("id", "00000000-0000-0000-0000-000000000000");
  if (categoryId) await service.from("product_categories").update({ image_url: previousCategoryImage }).eq("id", categoryId);
  for (const pathValue of objectPaths) {
    await service.storage.from("product-images").remove([pathValue]);
    await service.from("storage_object_operations").delete().eq("object_path", pathValue);
  }
  sql(`
    delete from public.product_delete_operations where sku_snapshot like ${quote(`${PREFIX}%`)};
    delete from public.storage_object_operations
      where owner_key in (select id::text from public.products where sku like ${quote(`${PREFIX}%`)})
         or object_path like ${quote(`%${PREFIX.toLowerCase()}%`)};
    delete from public.inventory_operations where variant_id in (
      select pv.id from public.product_variants pv join public.products p on p.id=pv.product_id where p.sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.stock_movements where variant_id in (
      select pv.id from public.product_variants pv join public.products p on p.id=pv.product_id where p.sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.inventory_balances where variant_id in (
      select pv.id from public.product_variants pv join public.products p on p.id=pv.product_id where p.sku like ${quote(`${PREFIX}%`)}
    );
    delete from public.product_variants where product_id in (select id from public.products where sku like ${quote(`${PREFIX}%`)});
    delete from public.product_operations where product_id in (select id from public.products where sku like ${quote(`${PREFIX}%`)});
    delete from public.products where sku like ${quote(`${PREFIX}%`)};
    delete from public.storage_object_operations where owner_key like ${quote(`${PREFIX}%`)};
    delete from public.developer_access;
  `);
  if (authUserId) await service.auth.admin.deleteUser(authUserId);
  if (previousFeature) await service.from("feature_settings").update(previousFeature).eq("id", 1);
}

const failed = results.filter((result) => !result.ok);
console.log(`Storage/image integration summary: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
