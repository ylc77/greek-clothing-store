import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DB_CONTAINER = "supabase_db_clothing_web";
const API_PORT = 55321;
const token = randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
const categoryId = randomUUID();
const subcategoryId = randomUUID();
const categorySlug = `audit-category-${token}`;
const subcategorySlug = `audit-subcategory-${token}`;
const productSku = `AUDIT-CATEGORY-${token.toUpperCase()}`;

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
    ? command(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npx.cmd supabase status -o env"])
    : command("npx", ["supabase", "status", "-o", "env"]);
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (match) values[match[1]] = match[2];
  }
  assert.equal(values.API_URL, `http://127.0.0.1:${API_PORT}`);
  assert.ok(values.ANON_KEY);
  assert.ok(values.SERVICE_ROLE_KEY);
  return values;
}

const local = localEnvironment();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anonymous = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function category(nameCn = "分类事务测试") {
  return {
    id: categoryId,
    slug: categorySlug,
    name_cn: nameCn,
    name_en: "Category transaction audit",
    name_gr: "Έλεγχος συναλλαγής κατηγορίας",
    image_url: "",
    sort_order: 9000,
    is_active: true,
  };
}

function subcategory() {
  return {
    id: subcategoryId,
    category_id: categoryId,
    slug: subcategorySlug,
    name_cn: "二级分类事务测试",
    name_en: "Subcategory transaction audit",
    name_gr: "Έλεγχος συναλλαγής υποκατηγορίας",
    sort_order: 1,
    is_active: true,
  };
}

async function apply({ categories = [category()], subcategories = [subcategory()], deletedCategoryIds = [], deletedSubcategoryIds = [] } = {}) {
  return service.rpc("category_catalog_apply_rpc", {
    p_categories: categories,
    p_subcategories: subcategories,
    p_deleted_category_ids: deletedCategoryIds,
    p_deleted_subcategory_ids: deletedSubcategoryIds,
  });
}

function cleanup() {
  sql(`
    delete from public.products where sku = '${productSku}';
    delete from public.product_subcategories where id = '${subcategoryId}';
    delete from public.product_categories where id = '${categoryId}';
  `);
}

async function main() {
  cleanup();
  try {
    const anonymousAttempt = await anonymous.rpc("category_catalog_apply_rpc", {
      p_categories: [],
      p_subcategories: [],
      p_deleted_category_ids: [],
      p_deleted_subcategory_ids: [],
    });
    assert.ok(anonymousAttempt.error, "anonymous must not execute category catalog mutations");

    const created = await apply();
    if (created.error) throw created.error;
    assert.equal(created.data.savedCategories, 1);
    assert.equal(created.data.savedSubcategories, 1);
    assert.equal(sql(`select count(*) from public.product_categories where id='${categoryId}' and slug='${categorySlug}';`), "1");
    assert.equal(sql(`select count(*) from public.product_subcategories where id='${subcategoryId}' and category_id='${categoryId}';`), "1");

    const replayed = await apply();
    if (replayed.error) throw replayed.error;
    assert.equal(sql(`select count(*) from public.product_categories where id='${categoryId}';`), "1");
    assert.equal(sql(`select count(*) from public.product_subcategories where id='${subcategoryId}';`), "1");

    const changedSlug = await apply({ categories: [{ ...category(), slug: `${categorySlug}-changed` }] });
    assert.ok(changedSlug.error);
    assert.match(changedSlug.error.message, /CATEGORY_SLUG_IMMUTABLE/);
    assert.equal(sql(`select slug from public.product_categories where id='${categoryId}';`), categorySlug);

    sql(`
      insert into public.products (
        sku,name_cn,name_en,name_gr,category,subcategory,price,stock,sizes,size_stock,is_active
      ) values (
        '${productSku}','分类占用测试','Category use test','Έλεγχος χρήσης κατηγορίας',
        '${categorySlug}','${subcategorySlug}',10,0,'ONE SIZE','{}'::jsonb,true
      );
    `);

    const blockedSubcategoryDelete = await apply({
      categories: [category("不应提交的名称")],
      subcategories: [],
      deletedSubcategoryIds: [subcategoryId],
    });
    assert.ok(blockedSubcategoryDelete.error);
    assert.match(blockedSubcategoryDelete.error.message, /SUBCATEGORY_IN_USE/);
    assert.equal(sql(`select name_cn from public.product_categories where id='${categoryId}';`), "分类事务测试", "blocked delete must roll back unrelated edits");
    assert.equal(sql(`select count(*) from public.product_subcategories where id='${subcategoryId}';`), "1");

    const blockedCategoryDelete = await apply({ categories: [], subcategories: [], deletedCategoryIds: [categoryId], deletedSubcategoryIds: [subcategoryId] });
    assert.ok(blockedCategoryDelete.error);
    assert.match(blockedCategoryDelete.error.message, /CATEGORY_IN_USE/);
    assert.equal(sql(`select count(*) from public.product_categories where id='${categoryId}';`), "1");

    sql(`delete from public.products where sku='${productSku}';`);
    const deleted = await apply({ categories: [], subcategories: [], deletedCategoryIds: [categoryId], deletedSubcategoryIds: [subcategoryId] });
    if (deleted.error) throw deleted.error;
    assert.equal(deleted.data.deletedCategories, 1);
    assert.equal(deleted.data.deletedSubcategories, 1);
    assert.equal(sql(`select count(*) from public.product_categories where id='${categoryId}';`), "0");
    assert.equal(sql(`select count(*) from public.product_subcategories where id='${subcategoryId}';`), "0");

    console.log("PASS category catalog create, replay, immutable slug, in-use protection, atomic rollback and delete");
  } finally {
    cleanup();
  }

  assert.equal(sql(`select count(*) from public.products where sku='${productSku}';`), "0");
  assert.equal(sql(`select count(*) from public.product_categories where id='${categoryId}';`), "0");
  assert.equal(sql(`select count(*) from public.product_subcategories where id='${subcategoryId}';`), "0");
  console.log("PASS category catalog integration cleanup exact zero");
}

main().catch((error) => {
  try { cleanup(); } catch {}
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
