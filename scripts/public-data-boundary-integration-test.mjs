import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const APP_PORT = 3316;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PREFIX = "AUDIT-PUBLIC-DATA-";
const XSS_MARKER = "AUDIT_JSONLD_XSS";
const MALICIOUS_NAME = `Audit </script><script data-audit-xss>${XSS_MARKER}</script>`;
const PASSWORDS = {
  owner: "AuditPublicOwner!2026-Alpha",
  staff: "AuditPublicStaff!2026-Bravo",
  inventory: "AuditPublicInventory!2026-Charlie",
  readonly: "AuditPublicReadonly!2026-Delta",
};
const AUTH_RATE_LIMIT_SECRET = "test-only-public-auth-rate-limit-secret-2026";
const results = [];

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) {
    if (options.sensitiveOutput) throw new Error(`${name} failed; sensitive output suppressed.`);
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr || ""}`);
  }
  return String(result.stdout || "").trim();
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
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`, "route tests must use clothing_web local API");
  assert.match(values.DB_URL || "", new RegExp(`127\\.0\\.0\\.1:${DB_PORT}/postgres$`));
  assert.ok(values.ANON_KEY);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

function redactLogs(value, local) {
  let redacted = String(value || "");
  for (const secret of [local.SERVICE_ROLE_KEY, local.ANON_KEY]) {
    if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted.slice(-5000);
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
      DEEPSEEK_API_KEY: "",
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

async function stopApp(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore" });
  else server.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 750));
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.role) headers["x-admin-password"] = PASSWORDS[options.role];
  const response = await fetch(`${APP_URL}${pathname}`, { method: options.method || "GET", headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();
  return { status: response.status, data, headers: response.headers };
}

function assertPrivateNoStore(response, label) {
  assert.match(
    response.headers.get("cache-control") || "",
    /(?:^|,)\s*private\s*(?:,|$)/i,
    `${label} is not private`,
  );
  assert.match(response.headers.get("cache-control") || "", /no-store/i, `${label} is cacheable`);
  assert.match(response.headers.get("cache-control") || "", /max-age=0/i, `${label} does not disable browser freshness`);
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

function assertMissing(object, fields, label) {
  for (const field of fields) assert.equal(field in object, false, `${label} leaked ${field}`);
}

const local = readLocalEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let previousFeature;
let server;
let supplierId = "";
let productId = 0;
let variantId = "";

async function cleanup() {
  if (productId) await service.from("products").delete().eq("id", productId);
  await service.from("products").delete().like("sku", `${PREFIX}%`);
  if (supplierId) await service.from("suppliers").delete().eq("id", supplierId);
  await service.from("suppliers").delete().like("code", `${PREFIX}%`);
}

try {
  await cleanup();
  const { data: feature, error: featureError } = await service
    .from("feature_settings")
    .select("plan,features,updated_by")
    .eq("id", 1)
    .single();
  if (featureError) throw featureError;
  previousFeature = feature;
  const { error: updateFeatureError } = await service.from("feature_settings").update({
    plan: "custom",
    features: { ...feature.features, product_management: true, inventory: true, staff_accounts: true },
    updated_by: "public-data-boundary-test",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (updateFeatureError) throw updateFeatureError;

  const { data: supplier, error: supplierError } = await service.from("suppliers").insert({
    code: `${PREFIX}SUP`,
    name: "Audit Private Supplier",
    vat_number: "EL123456789",
    contact_name: "Audit Private Person",
    phone: "+30 210 0000000",
    email: "audit-private@example.test",
    address: "Audit private address",
    country: "GR",
    notes: "Audit private negotiation notes",
    active: true,
  }).select("id").single();
  if (supplierError) throw supplierError;
  supplierId = String(supplier.id);

  const { data: product, error: productError } = await service.from("products").insert({
    sku: `${PREFIX}PRODUCT`,
    name_cn: "内部中文名",
    name_gr: MALICIOUS_NAME,
    name_en: MALICIOUS_NAME,
    description_cn: "内部说明",
    description_gr: "Δημόσια περιγραφή",
    description_en: "Public description",
    category: "women",
    subcategory: "dresses",
    price: 19.9,
    stock: 5,
    sizes: "M",
    size_stock: { M: 5 },
    supplier_id: supplierId,
    supplier_style_code: "PRIVATE-STYLE",
    barcode: "PRIVATE-PRODUCT-BARCODE",
    is_active: true,
  }).select("id").single();
  if (productError) throw productError;
  productId = Number(product.id);

  const { data: variant, error: variantError } = await service.from("product_variants").insert({
    product_id: productId,
    variant_sku: `${PREFIX}PRODUCT-M`,
    barcode: `${PREFIX}BARCODE-M`,
    size: "M",
    supplier_id: supplierId,
    supplier_sku: "PRIVATE-SUPPLIER-SKU-M",
    cost_price: 7.25,
    reorder_level: 2,
    active: true,
  }).select("id").single();
  if (variantError) throw variantError;
  variantId = String(variant.id);
  const { data: location, error: locationError } = await service.from("inventory_locations").select("id").eq("code", "MAIN_STORE").single();
  if (locationError) throw locationError;
  const { error: balanceError } = await service.from("inventory_balances").insert({
    variant_id: variantId,
    location_id: location.id,
    quantity_on_hand: 5,
    quantity_reserved: 0,
  });
  if (balanceError) throw balanceError;

  server = await startApp(local);

  await runCase("anonymous and developer-only Cookie cannot read admin data", async () => {
    for (const response of [
      await request("/api/admin/products"),
      await request("/api/admin/products", { headers: { cookie: "developer_session=not-an-admin-session" } }),
      await request("/api/admin/inventory"),
      await request("/api/admin/suppliers"),
    ]) {
      assert.equal(response.status, 401);
      assertPrivateNoStore(response, "unauthorized admin response");
    }
  });

  await runCase("admin session permissions are role-shaped and never shared-cacheable", async () => {
    const expected = {
      owner: { read: true, cost: true, write: true },
      inventory: { read: true, cost: false, write: false },
      staff: { read: false, cost: false, write: false },
      readonly: { read: false, cost: false, write: false },
    };
    for (const [role, permissions] of Object.entries(expected)) {
      const response = await request("/api/admin/session", { role });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assertPrivateNoStore(response, `${role} admin session`);
      assert.equal(response.data.role, role);
      assert.equal(response.data.permissions.includes("procurement:read"), permissions.read);
      assert.equal(response.data.permissions.includes("procurement:cost"), permissions.cost);
      assert.equal(response.data.permissions.includes("procurement:write"), permissions.write);
    }
  });

  await runCase("raw product HTML keeps stored script payload inside parseable JSON-LD", async () => {
    const response = await fetch(`${APP_URL}/product/${encodeURIComponent(`${PREFIX}PRODUCT`)}?lang=en`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal((html.match(/type="application\/ld\+json"/g) || []).length, 1);
    assert.doesNotMatch(html, /<script data-audit-xss>/i);
    assert.doesNotMatch(html, new RegExp(`</script><script[^>]*>${XSS_MARKER}`, "i"));
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    assert.ok(match, "product JSON-LD script was not rendered");
    const jsonLd = JSON.parse(match[1]);
    assert.equal(jsonLd.name, MALICIOUS_NAME);
    assert.equal(jsonLd["@type"], "Product");
  });

  await runCase("products API shapes procurement for every role", async () => {
    const ownerResponse = await request("/api/admin/products?limit=500", { role: "owner" });
    assert.equal(ownerResponse.status, 200, JSON.stringify(ownerResponse.data));
    assertPrivateNoStore(ownerResponse, "owner products");
    const owner = ownerResponse.data.products.find((item) => item.sku === `${PREFIX}PRODUCT`);
    assert.ok(owner);
    assert.equal(owner.supplier_id, supplierId);
    assert.equal(owner.supplier_style_code, "PRIVATE-STYLE");
    assert.equal(owner.variants[0].supplier_sku, "PRIVATE-SUPPLIER-SKU-M");
    assert.equal(owner.variants[0].cost_price, 7.25);

    const inventoryResponse = await request("/api/admin/products?limit=500", { role: "inventory" });
    assert.equal(inventoryResponse.status, 200, JSON.stringify(inventoryResponse.data));
    assertPrivateNoStore(inventoryResponse, "inventory products");
    const inventory = inventoryResponse.data.products.find((item) => item.sku === `${PREFIX}PRODUCT`);
    assert.equal(inventory.supplier_id, supplierId);
    assert.equal(inventory.variants[0].supplier_sku, "PRIVATE-SUPPLIER-SKU-M");
    assert.equal(inventory.variants[0].reorder_level, 2);
    assertMissing(inventory.variants[0], ["cost_price"], "inventory product Variant");

    for (const role of ["staff", "readonly"]) {
      const response = await request("/api/admin/products?limit=500", { role });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assertPrivateNoStore(response, `${role} products`);
      const item = response.data.products.find((entry) => entry.sku === `${PREFIX}PRODUCT`);
      assert.ok(item);
      assertMissing(item, ["supplier_id", "supplier_style_code", "variant_procurement"], `${role} product`);
      assertMissing(item.variants[0], ["supplier_id", "supplier_sku", "cost_price", "reorder_level"], `${role} Variant`);
    }
  });

  await runCase("owner response cannot poison a later lower-role cache entry", async () => {
    const owner = await request("/api/admin/products?limit=500", { role: "owner" });
    const readonly = await request("/api/admin/products?limit=500", { role: "readonly" });
    assertPrivateNoStore(owner, "owner cache sequence");
    assertPrivateNoStore(readonly, "readonly cache sequence");
    const item = readonly.data.products.find((entry) => entry.sku === `${PREFIX}PRODUCT`);
    assertMissing(item, ["supplier_id", "supplier_style_code", "variant_procurement"], "cached readonly product");
  });

  await runCase("inventory API exposes no procurement to staff/readonly and no cost to inventory", async () => {
    const ownerResponse = await request(`/api/admin/inventory?q=${PREFIX}PRODUCT`, { role: "owner" });
    assert.equal(ownerResponse.status, 200, JSON.stringify(ownerResponse.data));
    assertPrivateNoStore(ownerResponse, "owner inventory");
    const owner = ownerResponse.data.items.find((item) => item.variant_id === variantId);
    assert.equal(owner.cost_price, 7.25);

    const inventoryResponse = await request(`/api/admin/inventory?q=${PREFIX}PRODUCT`, { role: "inventory" });
    assert.equal(inventoryResponse.status, 200, JSON.stringify(inventoryResponse.data));
    assertPrivateNoStore(inventoryResponse, "inventory inventory");
    const inventory = inventoryResponse.data.items.find((item) => item.variant_id === variantId);
    assert.equal(inventory.supplier_sku, "PRIVATE-SUPPLIER-SKU-M");
    assert.equal(inventory.supplier_name, "Audit Private Supplier");
    assert.equal(inventory.reorder_level, 2);
    assertMissing(inventory, ["cost_price"], "inventory overview item");

    for (const role of ["staff", "readonly"]) {
      const response = await request(`/api/admin/inventory?q=${PREFIX}PRODUCT`, { role });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assertPrivateNoStore(response, `${role} inventory`);
      const item = response.data.items.find((entry) => entry.variant_id === variantId);
      assertMissing(item, ["supplier_sku", "supplier_name", "supplier_style_code", "cost_price", "reorder_level"], `${role} inventory item`);
    }
  });

  await runCase("suppliers API is owner full, inventory minimal, and denied to other roles", async () => {
    const ownerResponse = await request("/api/admin/suppliers", { role: "owner" });
    assert.equal(ownerResponse.status, 200, JSON.stringify(ownerResponse.data));
    assertPrivateNoStore(ownerResponse, "owner suppliers");
    const owner = ownerResponse.data.suppliers.find((item) => item.id === supplierId);
    assert.equal(owner.vat_number, "EL123456789");
    assert.equal(owner.email, "audit-private@example.test");

    const inventoryResponse = await request("/api/admin/suppliers", { role: "inventory" });
    assert.equal(inventoryResponse.status, 200, JSON.stringify(inventoryResponse.data));
    assertPrivateNoStore(inventoryResponse, "inventory suppliers");
    assert.deepEqual(inventoryResponse.data.suppliers.find((item) => item.id === supplierId), {
      id: supplierId,
      code: `${PREFIX}SUP`,
      name: "Audit Private Supplier",
      active: true,
    });

    for (const role of ["staff", "readonly"]) {
      const response = await request("/api/admin/suppliers", { role });
      assert.equal(response.status, 403, JSON.stringify(response.data));
      assertPrivateNoStore(response, `${role} suppliers denial`);
    }
  });
} finally {
  await stopApp(server);
  if (previousFeature) {
    const { error } = await service.from("feature_settings").update({
      plan: previousFeature.plan,
      features: previousFeature.features,
      updated_by: previousFeature.updated_by,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) console.error(`Failed to restore feature settings: ${error.message}`);
  }
  await cleanup();
  const [{ count: productsLeft }, { count: suppliersLeft }] = await Promise.all([
    service.from("products").select("id", { count: "exact", head: true }).like("sku", `${PREFIX}%`),
    service.from("suppliers").select("id", { count: "exact", head: true }).like("code", `${PREFIX}%`),
  ]);
  assert.equal(productsLeft, 0, "product fixture cleanup failed");
  assert.equal(suppliersLeft, 0, "supplier fixture cleanup failed");
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`${failures.length} public data boundary integration case(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`${results.length} public data boundary integration cases passed; fixtures were cleaned.`);
}
