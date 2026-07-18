import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:3010";
const inventoryItems = [
  { product_id: 101, product_name: "男士亚麻衬衫", product_sku: "men-shirts-001", variant_id: "inv-s", variant_sku: "men-shirts-001-s", size: "S", color: "Blue", barcode: "MEN001S", supplier_sku: "SUP-101-S", supplier_name: "Athens Fashion", supplier_style_code: "AF-101", cost_price: 12, reorder_level: 2, price: 39.9, active: true, quantity_on_hand: 5, quantity_reserved: 1, quantity_available: 4, legacy_stock: 5, erp_product_stock: 5, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 101, product_name: "男士亚麻衬衫", product_sku: "men-shirts-001", variant_id: "inv-m", variant_sku: "men-shirts-001-m", size: "M", color: "Blue", barcode: "MEN001M", supplier_sku: "SUP-101-M", supplier_name: "Athens Fashion", supplier_style_code: "AF-101", cost_price: 12, reorder_level: 2, price: 39.9, active: true, quantity_on_hand: 1, quantity_reserved: 0, quantity_available: 1, legacy_stock: 1, erp_product_stock: 1, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 102, product_name: "女士夏季连衣裙", product_sku: "women-dresses-001", variant_id: "inv-38", variant_sku: "women-dresses-001-38", size: "EU 38", color: "White", barcode: null, supplier_sku: null, supplier_name: null, supplier_style_code: null, cost_price: null, reorder_level: null, price: 54.9, active: true, quantity_on_hand: 0, quantity_reserved: 0, quantity_available: 0, legacy_stock: 0, erp_product_stock: 0, stock_matches_legacy: true, size_stock_matches_legacy: true },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mockAdmin(page) {
  await page.route("**/api/admin/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/session") return route.fulfill({ json: { ok: true, role: "owner", permissions: ["products:read", "products:write", "products:delete", "inventory:read", "inventory:write", "pos:read", "pos:checkout", "pos:void", "labels:write", "categories:write", "settings:write", "feed:read", "backup:read", "ai:write"], authType: "password", displayName: "Inventory QA" } });
    if (path === "/api/admin/products") return route.fulfill({ json: { products: [] } });
    if (path === "/api/admin/suppliers") return route.fulfill({ json: { suppliers: [] } });
    if (path === "/api/admin/categories") return route.fulfill({ json: { categories: [], subcategories: [] } });
    if (path === "/api/admin/features") return route.fulfill({ json: {} });
    if (path === "/api/admin/inventory") return route.fulfill({ json: { items: inventoryItems, total: inventoryItems.length } });
    if (path === "/api/admin/inventory/movements") return route.fulfill({ json: { items: [], total: 0 } });
    if (path === "/api/admin/inventory/reconciliation") return route.fulfill({ json: { stockVsBalanceMismatches: [], sizeStockMismatches: [], productsWithoutVariants: [], variantsWithoutMainStoreBalance: [], duplicateVariantSkus: [], duplicateBarcodes: [], reservedExceedsOnHand: [], blankMovementReasons: [] } });
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

async function openInventory(page) {
  const button = page.getByRole("button", { name: "库存管理", exact: true });
  if (!(await button.count()) || !(await button.first().isVisible())) {
    await page.getByRole("button", { name: "自定义", exact: true }).click();
    await page.getByRole("button", { name: "＋ 库存管理", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }
  await button.first().click();
  await page.getByRole("heading", { name: "库存管理", exact: true }).waitFor();
  await page.locator("[data-inventory-card]").first().waitFor();
}

async function assertNoOverflow(page, name) {
  assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), `${name}出现横向溢出`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
await mockAdmin(page);
await login(page);
assert(!(await page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]').isVisible()), "手机端仍显示 POS 扫码入口");
await openInventory(page);

assert(await page.locator("[data-inventory-filter-panel]").isVisible(), "库存筛选区没有显示");
assert(await page.locator("[data-inventory-mobile-list]").isVisible(), "手机端库存卡片没有显示");
assert(!(await page.locator("[data-inventory-desktop-table]").isVisible()), "手机端仍显示宽表格");
assert(await page.locator("[data-inventory-card]").count() === 3, "手机端库存卡片数量不正确");
await page.locator("[data-inventory-status]").selectOption("out_of_stock");
assert(await page.locator("[data-inventory-card]").count() === 1, "库存状态筛选没有同步更新卡片");
assert(await page.locator("[data-inventory-summary] > div").first().locator("p").first().textContent() === "1", "筛选后的统计数量不正确");
await page.locator("[data-inventory-status]").selectOption("all");
await page.locator("[data-inventory-card]").first().getByRole("button", { name: "调整库存", exact: true }).click();
assert(await page.getByRole("heading", { name: "调整库存", exact: true }).isVisible(), "移动端调整库存入口不可用");
await page.getByRole("button", { name: "关闭", exact: true }).click();
await assertNoOverflow(page, "手机端库存页");
await page.screenshot({ path: ".codex/ui-audit/inventory-layout/01-phone-inventory.png", fullPage: true });

await page.setViewportSize({ width: 1024, height: 900 });
assert(!(await page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]').isVisible()), "平板端仍显示 POS 扫码入口");
assert(await page.locator("[data-inventory-mobile-list]").isVisible(), "平板端库存卡片没有显示");
assert(!(await page.locator("[data-inventory-desktop-table]").isVisible()), "平板端仍显示宽表格");
await assertNoOverflow(page, "平板端库存页");
await page.screenshot({ path: ".codex/ui-audit/inventory-layout/02-tablet-inventory.png", fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
assert(await page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]').isVisible(), "桌面端 POS 扫码入口被错误隐藏");
assert(await page.locator("[data-inventory-desktop-table]").isVisible(), "桌面端库存表格没有显示");
assert(!(await page.locator("[data-inventory-mobile-list]").isVisible()), "桌面端仍显示移动库存卡片");
assert(await page.locator("[data-inventory-desktop-table] thead th").count() === 8, "桌面表格没有压缩为清晰的信息组");
await assertNoOverflow(page, "桌面端库存页");
await page.screenshot({ path: ".codex/ui-audit/inventory-layout/03-desktop-inventory.png", fullPage: true });

await page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]').click();
await page.getByRole("heading", { name: "POS 扫码", exact: true }).waitFor();
await page.setViewportSize({ width: 1024, height: 900 });
await page.getByRole("heading", { name: "POS 扫码", exact: true }).waitFor({ state: "detached" });
assert(!(await page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]').isVisible()), "从桌面缩小到平板后 POS 扫码仍可见");

assert(consoleErrors.length === 0, `控制台错误：${consoleErrors.join(" | ")}`);
console.log(JSON.stringify({ ok: true, groupedDesktopTable: true, mobileCards: true, filteredSummary: true, posDesktopOnly: true, responsive: true }));
await browser.close();
