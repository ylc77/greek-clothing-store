import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:3010";

const inventoryItems = [
  { product_id: 101, product_name: "男士亚麻衬衫", product_sku: "men-shirts-001", variant_id: "v-xs", variant_sku: "men-shirts-001-xs", size: "XS", color: "Blue", barcode: "MEN001XS", supplier_sku: "SUP-101-XS", supplier_name: "Athens Fashion", supplier_style_code: null, cost_price: 12, reorder_level: 2, price: 39.9, active: true, quantity_on_hand: 2, quantity_reserved: 0, quantity_available: 2, legacy_stock: 9, erp_product_stock: 9, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 101, product_name: "男士亚麻衬衫", product_sku: "men-shirts-001", variant_id: "v-s", variant_sku: "men-shirts-001-s", size: "S", color: "Blue", barcode: "MEN001S", supplier_sku: "SUP-101-S", supplier_name: "Athens Fashion", supplier_style_code: null, cost_price: 12, reorder_level: 2, price: 39.9, active: true, quantity_on_hand: 3, quantity_reserved: 0, quantity_available: 3, legacy_stock: 9, erp_product_stock: 9, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 101, product_name: "男士亚麻衬衫", product_sku: "men-shirts-001", variant_id: "v-m", variant_sku: "men-shirts-001-m", size: "M", color: "Blue", barcode: "MEN001M", supplier_sku: "SUP-101-M", supplier_name: "Athens Fashion", supplier_style_code: null, cost_price: 12, reorder_level: 2, price: 39.9, active: true, quantity_on_hand: 4, quantity_reserved: 0, quantity_available: 4, legacy_stock: 9, erp_product_stock: 9, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 101, product_name: "男士亚麻衬衫", product_sku: "men-shirts-001", variant_id: "v-l", variant_sku: "men-shirts-001-l", size: "L", color: "Blue", barcode: null, supplier_sku: "SUP-101-L", supplier_name: "Athens Fashion", supplier_style_code: null, cost_price: 12, reorder_level: 2, price: 39.9, active: true, quantity_on_hand: 0, quantity_reserved: 0, quantity_available: 0, legacy_stock: 9, erp_product_stock: 9, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 102, product_name: "女士夏季连衣裙", product_sku: "women-dresses-001", variant_id: "v-36", variant_sku: "women-dresses-001-36", size: "EU 36", color: "White", barcode: "WOMEN00136", supplier_sku: null, supplier_name: null, supplier_style_code: null, cost_price: null, reorder_level: null, price: 54.9, active: true, quantity_on_hand: 1, quantity_reserved: 0, quantity_available: 1, legacy_stock: 3, erp_product_stock: 3, stock_matches_legacy: true, size_stock_matches_legacy: true },
  { product_id: 102, product_name: "女士夏季连衣裙", product_sku: "women-dresses-001", variant_id: "v-38", variant_sku: "women-dresses-001-38", size: "EU 38", color: "White", barcode: "WOMEN00138", supplier_sku: null, supplier_name: null, supplier_style_code: null, cost_price: null, reorder_level: null, price: 54.9, active: true, quantity_on_hand: 2, quantity_reserved: 0, quantity_available: 2, legacy_stock: 3, erp_product_stock: 3, stock_matches_legacy: true, size_stock_matches_legacy: true },
];

const products = [
  { id: "101", sku: "men-shirts-001", name_cn: "男士亚麻衬衫", name_gr: "", name_en: "Men Linen Shirt", category: "men", subcategory: "shirts", price: 39.9, stock: 9, size_stock: { XS: 2, S: 3, M: 4, L: 0 }, sizes: "XS/S/M/L", is_active: true },
  { id: "102", sku: "women-dresses-001", name_cn: "女士夏季连衣裙", name_gr: "", name_en: "Women Summer Dress", category: "women", subcategory: "dresses", price: 54.9, stock: 3, size_stock: { "EU 36": 1, "EU 38": 2 }, sizes: "EU 36/EU 38", is_active: true },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mockAdmin(page) {
  await page.route("**/api/admin/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/session") {
      return route.fulfill({ json: { ok: true, role: "owner", permissions: ["products:read", "products:write", "products:delete", "inventory:read", "inventory:write", "pos:read", "pos:checkout", "pos:void", "labels:write", "categories:write", "settings:write", "feed:read", "backup:read", "ai:write"], authType: "password", displayName: "Label QA" } });
    }
    if (url.pathname === "/api/admin/products") return route.fulfill({ json: { products } });
    if (url.pathname === "/api/admin/suppliers") return route.fulfill({ json: { suppliers: [] } });
    if (url.pathname === "/api/admin/inventory") return route.fulfill({ json: { items: inventoryItems, total: inventoryItems.length } });
    if (url.pathname === "/api/admin/categories") return route.fulfill({ json: {
      categories: [
        { id: "cat-men", slug: "men", name_cn: "男装", name_en: "Men", name_gr: "Ανδρικά", is_active: true },
        { id: "cat-women", slug: "women", name_cn: "女装", name_en: "Women", name_gr: "Γυναικεία", is_active: true },
      ],
      subcategories: [
        { id: "sub-shirts", category_id: "cat-men", slug: "shirts", name_cn: "衬衫", name_en: "Shirts", name_gr: "Πουκάμισα", is_active: true },
        { id: "sub-dresses", category_id: "cat-women", slug: "dresses", name_cn: "连衣裙", name_en: "Dresses", name_gr: "Φορέματα", is_active: true },
      ],
    } });
    if (url.pathname === "/api/admin/features") return route.fulfill({ json: {} });
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

async function openLabels(page) {
  const labelButton = page.getByRole("button", { name: "标签打印", exact: true });
  if (!(await labelButton.count()) || !(await labelButton.first().isVisible())) {
    await page.getByRole("button", { name: "自定义", exact: true }).click();
    await page.getByRole("button", { name: "＋ 标签打印", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }
  await labelButton.first().click();
  await page.getByRole("heading", { name: "标签打印", exact: true }).waitFor();
}

async function noOverflow(page, viewportName) {
  assert(await page.locator("body").evaluate(body => body.scrollWidth <= document.documentElement.clientWidth), `${viewportName}标签页出现横向溢出`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
await mockAdmin(page);
await login(page);
await openLabels(page);

assert(await page.locator("[data-label-variant]").count() === 0, "标签页默认仍堆放所有 Variant");
assert(await page.locator("[data-label-product-card]").count() === 2, "标签页默认没有显示全部商品分组");
assert(await page.locator("[data-label-category-filter] option").count() === 3, "标签页一级分类选择器不完整");
await page.locator("[data-label-category-filter]").selectOption("men");
assert(await page.locator("[data-label-category-filter] option:checked").textContent() === "men · 男装", "标签页一级分类没有显示英文和中文");
assert(await page.locator("[data-label-product-card]").count() === 1, "一级分类没有筛选商品列表");
assert(await page.locator("[data-label-subcategory-filter] option").count() === 2, "选择一级分类后没有联动二级分类");
await page.locator("[data-label-subcategory-filter]").selectOption("shirts");
assert(await page.locator("[data-label-subcategory-filter] option:checked").textContent() === "shirts · 衬衫", "标签页二级分类没有显示英文和中文");
await page.locator("[data-label-category-filter]").selectOption("");

await page.locator("[data-label-search]").fill("MEN001M");
await page.locator("[data-label-search]").press("Enter");
assert(await page.locator("[data-label-size-panel]").isVisible(), "扫描条码后没有打开所属商品尺码区");
assert(await page.locator("[data-label-size-filter]").inputValue() === "M", "扫描 Variant 条码后没有定位到对应尺码");
assert(await page.locator("[data-label-variant]").count() === 1, "定位尺码后没有只显示对应 Variant");

await page.locator("[data-label-size-filter]").selectOption("");
assert(await page.locator("[data-label-variant]").count() === 4, "选择商品后没有显示该商品的全部尺码");
await page.locator('[data-label-variant="v-s"] input[type="checkbox"]').check();
await page.locator('[data-label-variant="v-m"] input[type="checkbox"]').check();
assert(await page.locator("[data-label-print-queue]").isVisible(), "已选尺码没有进入待打印区");
assert(await page.getByText("待打印标签（2）", { exact: true }).isVisible(), "待打印数量不正确");

await page.locator("[data-label-search]").fill("");
await page.locator('[data-label-product-card="102"]').click();
assert(await page.locator("[data-label-variant]").count() === 2, "切换商品后没有显示新商品尺码");
assert(await page.getByText("男士亚麻衬衫", { exact: true }).last().isVisible(), "切换商品后丢失了之前的已选标签");
await page.locator('[data-label-variant="v-36"] input[type="checkbox"]').check();
assert(await page.getByText("待打印标签（3）", { exact: true }).isVisible(), "跨商品标签选择没有保留");
await noOverflow(page, "手机端");
await page.screenshot({ path: ".codex/ui-audit/label-picker/01-phone-label-picker.png", fullPage: true });

await page.setViewportSize({ width: 1024, height: 900 });
await noOverflow(page, "平板端");
assert(await page.locator("[data-label-variant-grid]").isVisible(), "平板端尺码卡片没有显示");
await page.screenshot({ path: ".codex/ui-audit/label-picker/02-tablet-label-picker.png", fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
await page.locator('[data-label-product-card="101"]').click();
await page.locator("[data-label-size-filter]").selectOption("");
await noOverflow(page, "桌面端");
assert(await page.locator("[data-label-variant]").count() === 4, "桌面端尺码卡片数量不正确");
await page.screenshot({ path: ".codex/ui-audit/label-picker/03-desktop-label-picker.png", fullPage: true });

assert(consoleErrors.length === 0, `控制台错误：${consoleErrors.join(" | ")}`);
console.log(JSON.stringify({ ok: true, defaultProductGroups: true, categoryFilters: true, exactBarcodeLookup: true, crossProductSelection: true, responsive: true }));
await browser.close();
