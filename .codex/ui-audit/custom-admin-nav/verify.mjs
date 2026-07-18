import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:3010";
const expectedDefault = ["stockLookup", "pos", "quickAdd", "add", "dashboard"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mockAdmin(page) {
  await page.route("**/api/admin/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/admin/session") {
      return route.fulfill({ json: { ok: true, role: "owner", permissions: ["products:read", "products:write", "products:delete", "inventory:read", "inventory:write", "pos:read", "pos:checkout", "pos:void", "labels:write", "categories:write", "settings:write", "feed:read", "backup:read", "ai:write"], authType: "password", displayName: "UI QA" } });
    }
    if (path === "/api/admin/products") return route.fulfill({ json: { products: [] } });
    if (path === "/api/admin/suppliers") return route.fulfill({ json: { suppliers: [] } });
    if (path === "/api/admin/categories") return route.fulfill({ json: {
      categories: [{ id: "cat-men", slug: "men", name_cn: "男装", name_en: "Men", name_gr: "Ανδρικά", is_active: true }],
      subcategories: [{ id: "sub-tshirts", category_id: "cat-men", slug: "tshirts", name_cn: "T恤", name_en: "T-shirts", name_gr: "T-shirts", is_active: true }],
    } });
    if (path === "/api/admin/features") return route.fulfill({ json: {} });
    return route.fulfill({ json: {} });
  });
}

async function login(page) {
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "应急密码" }).click();
  await page.locator('input[type="password"]').fill("ui-only-test");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "商品管理后台" }).waitFor();
}

async function commonKeys(page) {
  return page.locator("[data-admin-common-tabs] [data-admin-tab]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-admin-tab")));
}

async function assertCategoryFilters(page, moduleName) {
  const category = page.locator("[data-admin-category-filter]");
  const subcategory = page.locator("[data-admin-subcategory-filter]");
  await category.selectOption("men");
  await subcategory.selectOption("tshirts");
  assert(await category.locator("option:checked").textContent() === "men · 男装", `${moduleName}一级分类没有显示英文和中文`);
  assert(await subcategory.locator("option:checked").textContent() === "tshirts · T恤", `${moduleName}二级分类没有显示英文和中文`);
  assert(await category.inputValue() === "men" && await subcategory.inputValue() === "tshirts", `${moduleName}分类真实值不再是英文 slug`);
}

async function addCommonTool(page, label) {
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await page.getByRole("button", { name: `＋ ${label}` }).click();
  await page.getByRole("button", { name: "完成" }).click();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
await mockAdmin(page);
await page.goto(`${baseUrl}/admin`);
await page.evaluate(() => localStorage.removeItem("clothing-admin-common-tabs-v1"));
await login(page);

assert(JSON.stringify(await commonKeys(page)) === JSON.stringify(expectedDefault), "默认常用操作顺序不正确");
assert(!(await page.locator('[data-admin-common-tabs] [data-admin-tab="stockOperations"]').count()), "库存作业仍在默认常用操作中");
assert(await page.locator('[data-admin-common-tabs] [data-admin-tab="add"]').count(), "新增/编辑没有移到默认常用操作");

await page.getByRole("button", { name: "自定义", exact: true }).click();
await page.getByRole("button", { name: "＋ 库存作业" }).click();
assert(await page.locator('[data-admin-common-tabs] [data-admin-tab="stockOperations"]').count(), "库存作业未能加入常用操作");
await page.getByLabel("将库存作业向前移动").click();
const reordered = await commonKeys(page);
assert(reordered.at(-2) === "stockOperations", "常用操作排序没有生效");

await page.getByRole("button", { name: "拍照上新", exact: true }).first().click();
assert(await page.getByText("AI 一键生成商品资料", { exact: true }).isVisible(), "拍照上新的选填与 AI 模块仍被折叠");
assert(await page.locator('[data-admin-field="quick-category"] option:checked').textContent() === "men · 男装", "拍照上新的一级分类没有显示英文和分类管理中文名");
assert(await page.locator('[data-admin-field="quick-subcategory"] option:checked').textContent() === "tshirts · T恤", "拍照上新的二级分类没有显示英文和分类管理中文名");
assert(await page.locator('[data-admin-field="quick-category"]').inputValue() === "men", "拍照上新的一级分类真实值不再是英文 slug");
assert(await page.locator('[data-admin-field="quick-subcategory"]').inputValue() === "tshirts", "拍照上新的二级分类真实值不再是英文 slug");
assert(await page.getByText("下一件 SKU：men-tshirts-001", { exact: true }).isVisible(), "拍照上新的 SKU 没有继续使用英文分类编码");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "手机端拍照上新出现横向溢出");
await page.screenshot({ path: ".codex/ui-audit/custom-admin-nav/01-phone-quick-add-open.png", fullPage: true });

await page.getByRole("button", { name: "新增/编辑", exact: true }).first().click();
assert(await page.getByText("链接、条码与商品标识（选填）", { exact: true }).isVisible(), "链接、条码与商品标识模块仍被折叠或隐藏");
assert(await page.locator('[data-admin-field="category"] option:checked').textContent() === "men · 男装", "新增/编辑的一级分类没有显示英文和分类管理中文名");
assert(await page.locator('[data-admin-field="subcategory"] option:checked').textContent() === "tshirts · T恤", "新增/编辑的二级分类没有显示英文和分类管理中文名");
await page.getByRole("button", { name: "生成编号" }).click();
assert(await page.locator('[data-admin-field="sku"]').inputValue() === "men-tshirts-001", "新增/编辑生成的 SKU 没有继续使用英文分类编码");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "手机端新增/编辑出现横向溢出");
await page.screenshot({ path: ".codex/ui-audit/custom-admin-nav/02-phone-add-open.png", fullPage: true });

await page.getByRole("button", { name: "商品列表", exact: true }).first().click();
await assertCategoryFilters(page, "商品列表");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "手机端商品列表双语分类出现横向溢出");

await addCommonTool(page, "快速售出");
await page.getByRole("button", { name: "快速售出", exact: true }).first().click();
await assertCategoryFilters(page, "快速售出");

await addCommonTool(page, "图片上传");
await page.getByRole("button", { name: "图片上传", exact: true }).first().click();
await assertCategoryFilters(page, "图片上传");

await addCommonTool(page, "分类管理");
await page.getByRole("button", { name: "分类管理", exact: true }).first().click();
assert(await page.getByText("men · 男装", { exact: true }).first().isVisible(), "分类管理没有统一显示英文和中文");
assert(await page.getByText("tshirts · T恤", { exact: true }).first().isVisible(), "二级分类管理没有统一显示英文和中文");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "手机端分类管理双语名称出现横向溢出");

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("clothing-admin-common-tabs-v1") || "[]"));
assert(stored.includes("stockOperations"), "常用操作没有保存到当前浏览器");
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "应急密码" }).click();
await page.locator('input[type="password"]').fill("ui-only-test");
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.getByRole("heading", { name: "商品管理后台" }).waitFor();
assert(JSON.stringify(await commonKeys(page)) === JSON.stringify(stored), "刷新页面后常用操作设置没有恢复");

await page.setViewportSize({ width: 1024, height: 900 });
await page.getByRole("button", { name: "拍照上新", exact: true }).first().click();
assert(await page.locator('[data-admin-field="quick-category"] option:checked').textContent() === "men · 男装", "平板端一级分类双语显示不正确");
assert(await page.locator('[data-admin-field="quick-subcategory"] option:checked').textContent() === "tshirts · T恤", "平板端二级分类双语显示不正确");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "平板端双语分类出现横向溢出");
await page.screenshot({ path: ".codex/ui-audit/custom-admin-nav/05-tablet-category-labels.png", fullPage: true });
await page.getByRole("button", { name: "自定义", exact: true }).click();
assert(await page.locator("[data-admin-common-customizer]").isVisible(), "平板端无法打开常用操作自定义");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "平板端自定义面板出现横向溢出");
await page.screenshot({ path: ".codex/ui-audit/custom-admin-nav/03-tablet-customize.png", fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole("button", { name: "商品列表", exact: true }).first().click();
await assertCategoryFilters(page, "桌面端商品列表");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "桌面端双语分类出现横向溢出");
await page.screenshot({ path: ".codex/ui-audit/custom-admin-nav/06-desktop-category-filters.png", fullPage: true });
const moreTools = page.getByText("更多管理工具", { exact: true });
await moreTools.click();
assert(await page.locator('[data-admin-advanced-tabs] [data-admin-tab="stockOperations"]').count() === 0, "已加入常用的库存作业仍显示在更多工具");
assert(await page.locator('[data-admin-advanced-tabs] [data-admin-tab="add"]').count() === 0, "新增/编辑仍显示在更多工具");
assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), "桌面端出现横向溢出");
await page.screenshot({ path: ".codex/ui-audit/custom-admin-nav/04-desktop-tools.png", fullPage: true });

assert(consoleErrors.length === 0, `控制台错误：${consoleErrors.join(" | ")}`);
console.log(JSON.stringify({ ok: true, defaultCommon: expectedDefault, reordered, stored, responsive: true }));
await browser.close();
