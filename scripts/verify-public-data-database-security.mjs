import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const API_PORT = 55321;
const DB_PORT = 55322;
const DB_CONTAINER = "supabase_db_clothing_web";
const SKU = "AUDIT-PUBLIC-DATA-DB";

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

function sql(statement) {
  return command("docker", [
    "exec", "-i", DB_CONTAINER,
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: statement });
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
  assert.ok(values.ANON_KEY);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

const local = readLocalEnvironment();
const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  await service.from("products").delete().eq("sku", SKU);
  const { error: insertError } = await service.from("products").insert({
    sku: SKU,
    name_cn: "内部中文名",
    name_gr: "Δημόσιο όνομα",
    name_en: "Public name",
    description_cn: "内部说明",
    description_gr: "Δημόσια περιγραφή",
    description_en: "Public description",
    category: "women",
    subcategory: "dresses",
    price: 19.9,
    stock: 1,
    supplier_style_code: "PRIVATE-STYLE",
    barcode: "PRIVATE-INTERNAL-BARCODE",
    is_active: true,
  });
  if (insertError) throw insertError;

  const { data: publicRow, error: publicError } = await anon
    .from("products")
    .select("sku,name_gr,name_en,description_gr,description_en,price,stock")
    .eq("sku", SKU)
    .single();
  assert.ifError(publicError);
  assert.equal(publicRow.sku, SKU);

  for (const restricted of ["supplier_id", "supplier_style_code", "name_cn", "description_cn", "barcode", "metadata_version"]) {
    const { error } = await anon.from("products").select(`sku,${restricted}`).eq("sku", SKU).maybeSingle();
    assert.ok(error, `anon unexpectedly selected ${restricted}`);
    assert.equal(error.code, "42501", `anon ${restricted} should fail with PostgreSQL permission denied`);
  }

  const { error: wildcardError } = await anon.from("products").select("*").eq("sku", SKU).maybeSingle();
  assert.ok(wildcardError, "anon select(*) must fail when any products column is private");
  assert.equal(wildcardError.code, "42501");

  assert.equal(sql("select has_table_privilege('anon','public.products','select');"), "f");
  assert.equal(sql("select has_table_privilege('authenticated','public.products','select');"), "f");
  for (const role of ["anon", "authenticated"]) {
    assert.equal(sql(`select has_column_privilege('${role}','public.products','sku','select');`), "t");
    assert.equal(sql(`select has_column_privilege('${role}','public.products','supplier_id','select');`), "f");
  }

  const rls = sql("select relrowsecurity from pg_class where oid = 'public.products'::regclass;");
  assert.equal(rls, "t");
  const policyRoles = sql("select array_to_string(roles, ',') from pg_policies where schemaname='public' and tablename='products' and policyname='Public read active products';");
  assert.match(policyRoles, /anon/);
  assert.match(policyRoles, /authenticated/);

  const { data: privateRow, error: serviceError } = await service
    .from("products")
    .select("sku,name_cn,description_cn,barcode,supplier_style_code,metadata_version")
    .eq("sku", SKU)
    .single();
  assert.ifError(serviceError);
  assert.equal(privateRow.supplier_style_code, "PRIVATE-STYLE");

  console.log("Public product database boundary passed for anon/authenticated/service_role.");
} finally {
  const { error } = await service.from("products").delete().eq("sku", SKU);
  if (error) throw error;
  const { count, error: countError } = await service.from("products").select("id", { count: "exact", head: true }).eq("sku", SKU);
  if (countError) throw countError;
  assert.equal(count, 0, "public data DB fixture cleanup failed");
}
