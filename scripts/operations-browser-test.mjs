/* eslint-disable no-console */
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
const failures = [];

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, callback) {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name}: ${message}`);
  }
}

const ownerPermissions = [
  "products:read", "products:write", "products:delete", "inventory:read", "inventory:write",
  "pos:read", "pos:checkout", "pos:void", "labels:write", "categories:write", "feed:read",
  "backup:read", "ai:write", "procurement:read", "procurement:cost", "procurement:write",
];
const features = {
  storefront: true, product_management: true, inventory: true, pos_checkout: true, pos_orders: true,
  pos_void: true, pos_reports: true, receipt_printing: true, barcode_labels: true, csv_import: true,
  staff_accounts: true, ai_tools: true, backup_tools: true,
};
const variantId = "6b000000-0000-4000-8000-000000000001";
const orderId = "6b000000-0000-4000-8000-000000000002";
const createdAt = "2026-07-15T20:30:00.000Z";
const inventoryItem = {
  product_id: 600001,
  product_name: "Internal fixture",
  product_name_en: "6B Test Dress",
  product_name_gr: "Φόρεμα δοκιμής 6B",
  product_sku: "AUDIT_6B_DRESS",
  category: "women",
  subcategory: "dresses",
  variant_id: variantId,
  variant_sku: "AUDIT-6B-DRESS-M",
  size: "M",
  color: "Μαύρο",
  barcode: "AUDIT6BDRESSM",
  supplier_sku: "SUP-6B-M",
  supplier_name: "Audit supplier",
  supplier_style_code: "AUDIT-6B",
  cost_price: 20,
  reorder_level: 1,
  price: 39.9,
  active: true,
  quantity_on_hand: 2,
  quantity_reserved: 0,
  quantity_available: 2,
  legacy_stock: 2,
  erp_product_stock: 2,
  stock_matches_legacy: true,
  size_stock_matches_legacy: true,
};
const missingBarcodeItem = {
  ...inventoryItem,
  variant_id: "6b000000-0000-4000-8000-000000000005",
  variant_sku: "AUDIT-6B-DRESS-L",
  size: "L",
  barcode: null,
  quantity_on_hand: 1,
  quantity_available: 1,
};
const order = {
  id: orderId,
  order_number: "AUDIT-6B-ORDER",
  status: "completed",
  payment_status: "paid",
  source: "pos",
  subtotal: 39.9,
  discount_total: 0,
  total: 39.9,
  currency: "EUR",
  created_by: "account:owner:2d5409d8-604f-45db-a7ee-00450c60e006",
  notes: "AUDIT 6B",
  created_at: createdAt,
  completed_at: createdAt,
  voided_at: null,
  refunded_at: null,
  payment_method: "cash",
  items_count: 1,
};
const detail = {
  ok: true,
  order,
  items: [{
    id: "6b000000-0000-4000-8000-000000000003",
    product_id: inventoryItem.product_id,
    variant_id: variantId,
    product_sku: inventoryItem.product_sku,
    variant_sku: inventoryItem.variant_sku,
    barcode: inventoryItem.barcode,
    name: "Internal fixture",
    name_en: inventoryItem.product_name_en,
    name_gr: inventoryItem.product_name_gr,
    size: "M",
    color: "Μαύρο",
    quantity: 1,
    unit_price: 39.9,
    discount_total: 0,
    line_total: 39.9,
    created_at: createdAt,
  }],
  payments: [{
    id: "6b000000-0000-4000-8000-000000000004",
    method: "cash",
    amount: 39.9,
    currency: "EUR",
    status: "paid",
    created_at: createdAt,
  }],
  stock_movements: [],
};

function mockedResponse(url, method = "GET") {
  const parsed = new URL(url);
  const pathname = parsed.pathname;
  if (pathname === "/api/admin/session") return { ok: true, role: "owner", permissions: ownerPermissions, authType: "password", displayName: "6B Browser Owner" };
  if (pathname === "/api/admin/features") return { ok: true, settings: { plan: "advanced", features, configured: true } };
  if (pathname === "/api/admin/categories") return { ok: true, categories: [], subcategories: [] };
  if (pathname === "/api/admin/suppliers") return { ok: true, suppliers: [] };
  if (pathname === "/api/admin/products") return { ok: true, products: [], total: 0 };
  if (pathname === "/api/admin/inventory") return { ok: true, items: [inventoryItem, missingBarcodeItem], total: 2 };
  if (pathname === "/api/admin/pos/health") return { ok: true, ready: true, runtimeHealth: { ready: true } };
  if (pathname === `/api/admin/pos/orders/${orderId}`) return detail;
  if (pathname === `/api/admin/pos/orders/${orderId}/returns`) {
    if (method === "POST") return {
      ok: true,
      rpc: true,
      alreadyProcessed: false,
      return: {
        id: "6b000000-0000-4000-8000-000000000007",
        return_number: "RET-AUDIT-6B",
        original_order_id: orderId,
        status: "completed",
        reason: "Browser return fixture",
        return_subtotal: 39.9,
        exchange_subtotal: 39.9,
        balance_delta: 0,
        external_action: "none",
        external_method: null,
        external_reference: null,
      },
      affected_skus: [inventoryItem.product_sku],
    };
    return { ok: true, returns: [] };
  }
  if (pathname === "/api/admin/pos/search") return { ok: true, items: [missingBarcodeItem] };
  if (pathname === "/api/admin/pos/orders") return { ok: true, orders: [order], total: 1, limit: 100, offset: 0 };
  return { ok: true };
}

async function login(page) {
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  const emergencyMode = page.getByRole("button", { name: "应急密码", exact: true });
  if (await emergencyMode.count()) await emergencyMode.click();
  await page.locator("#admin-emergency-password").fill("Browser-only mocked credential");
  await page.locator("form button").last().click();
  await page.locator("header").waitFor();
}

async function selectAdminTab(page, key) {
  const compact = page.viewportSize().width < 1280;
  if (compact) await page.getByRole("button", { name: /^菜单 ·/ }).click();
  if (key === "labels") {
    await page.locator('[data-admin-section="more"]:visible').click();
    await page.locator('[data-admin-management-group="store"] summary').click();
    await page.locator('[data-admin-tool="labels"]').click();
    return;
  }
  if (key === "posOrders") {
    await page.locator('[data-admin-section="orders"]:visible').click();
    await page.getByLabel("订单来源", { exact: true }).selectOption("store");
    return;
  }
  throw new Error(`unmapped test view ${key}`);
}

async function openLabels(page) {
  await selectAdminTab(page, "labels");
  await page.locator("[data-label-product-card]").first().waitFor();
  await page.locator("[data-barcode-recovery]").waitFor();
  await page.getByRole("button", { name: "选择当前缺失（1）", exact: true }).click();
  await page.getByText("已选择：1 件商品 / 1 个规格", { exact: true }).waitFor();
  await page.getByRole("button", { name: /补全已选缺失 Barcode（1）/ }).click();
  const dialog = page.getByRole("heading", { name: "确认补全缺失 Barcode？", exact: true }).locator("..");
  expect((await dialog.innerText()).includes("1 个规格缺少 Barcode"), "bulk Barcode confirmation has incorrect missing count");
  expect((await dialog.innerText()).includes("0 个已有 Barcode"), "bulk Barcode confirmation has incorrect skipped count");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await page.getByText("已选择：0 件商品 / 0 个规格", { exact: true }).waitFor();
  expect(await page.locator("[data-label-print-queue]").count() === 0, "cancel selection did not clear the print queue");
  await page.locator("[data-label-product-card]").first().click();
  await page.locator("[data-label-variant] input[type=checkbox]").first().check();
  await page.locator("[data-label-paper-size]").selectOption("40x30");
  await page.getByRole("button", { name: /打印标签（2 张）/ }).click();
  await page.locator(".label-page").first().waitFor();
}

async function verifyLabelPreview(page, label) {
  const pages = page.locator(".label-page");
  expect(await pages.count() === 2, `${label} label copies did not default to on-hand stock`);
  const printText = await page.locator(".label-print-root").innerText();
  expect(printText.includes("Φόρεμα δοκιμής 6B"), `${label} label is missing Greek product copy`);
  expect(!/[\u4e00-\u9fff]/u.test(printText), `${label} printed label exposed internal Chinese copy`);
  const storeName = (await pages.first().locator("p").first().innerText()).trim();
  expect(storeName.length > 1 && storeName !== "-" && !/online store|clothing store/i.test(storeName), `${label} label uses placeholder branding`);
  await page.waitForFunction(() => document.querySelector("svg[data-barcode]")?.childElementCount > 0);
  const width = await pages.first().evaluate((element) => element.getBoundingClientRect().width);
  expect(width >= 145 && width <= 160, `${label} 40mm label rendered at ${width}px`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, `${label} label preview causes ${overflow}px root overflow`);
}

async function openReceipt(page) {
  await page.locator(".label-no-print").getByRole("button", { name: "关闭", exact: true }).click();
  await selectAdminTab(page, "posOrders");
  await page.getByText("AUDIT-6B-ORDER", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.getByRole("button", { name: "查看 / 打印小票", exact: true }).click();
  await page.locator(".pos-receipt-print-root").waitFor();
}

async function verifyReceiptPreview(page, label) {
  const receipt = page.locator(".pos-receipt-print-root");
  const printText = await receipt.innerText();
  expect(printText.includes("Φόρεμα δοκιμής 6B"), `${label} receipt is missing Greek product copy`);
  expect(printText.includes("15/07/2026, 23:30"), `${label} receipt does not display Europe/Athens time`);
  expect(printText.includes("όχι φορολογική απόδειξη ή τιμολόγιο"), `${label} receipt disclaimer is missing`);
  expect(!/[\u4e00-\u9fff]/u.test(printText), `${label} printed receipt exposed internal Chinese copy`);
  const storeName = (await receipt.locator("h1").innerText()).trim();
  expect(storeName.length > 1 && storeName !== "-" && !/online store|clothing store/i.test(storeName), `${label} receipt uses placeholder branding`);
  const width80 = await receipt.evaluate((element) => element.getBoundingClientRect().width);
  expect(width80 >= 295 && width80 <= 310, `${label} 80mm receipt rendered at ${width80}px`);
  await page.locator(".pos-receipt-no-print").getByRole("button", { name: "58mm", exact: true }).click();
  const width58 = await receipt.evaluate((element) => element.getBoundingClientRect().width);
  expect(width58 >= 215 && width58 <= 225, `${label} 58mm receipt rendered at ${width58}px`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, `${label} receipt preview causes ${overflow}px root overflow`);
}

async function verifyReturnExchange(page, label, state) {
  await page.locator(".pos-receipt-no-print").getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "部分退货 / 换货", exact: true }).click();
  await page.getByRole("heading", { name: /退货与换货/ }).waitFor();
  await page.getByRole("heading", { name: "1. 选择退入商品", exact: true }).locator("..").getByRole("checkbox").first().check();
  const search = page.getByPlaceholder("扫描 Barcode 或搜索 SKU / 商品名", { exact: true });
  await search.focus();
  await page.keyboard.type(missingBarcodeItem.variant_sku, { delay: 5 });
  await page.keyboard.press("Enter");
  await page.getByText(`${missingBarcodeItem.variant_sku} 已加入换出清单。`, { exact: true }).waitFor();
  await page.getByText("无需补退").waitFor();
  await page.locator("textarea").fill("Browser return fixture");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "确认退货 / 换货", exact: true }).click();
  await page.getByRole("heading", { name: "退换货已完成", exact: true }).waitFor();
  const receipt = page.locator(".pos-return-receipt");
  expect((await receipt.innerText()).includes("不是 AADE 税务票据"), `${label} return receipt disclaimer is missing`);
  expect(state.returnPosts === 1, `${label} return submitted ${state.returnPosts} times`);
  expect(typeof state.returnBody?.clientRequestId === "string" && state.returnBody.clientRequestId.length > 10, `${label} return operation ID is missing`);
  expect(state.returnBody?.returnItems?.[0]?.orderItemId === detail.items[0].id, `${label} returned the wrong order line`);
  expect(state.returnBody?.exchangeItems?.[0]?.variantId === missingBarcodeItem.variant_id, `${label} exchanged the wrong Variant`);
  expect(state.returnBody?.externalConfirmation?.expectedBalanceDelta === 0, `${label} submitted the wrong expected balance`);
}

const browser = await chromium.launch({ headless: true });
for (const viewport of [
  { width: 390, height: 844, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1440, height: 1000, label: "desktop" },
]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const state = { returnPosts: 0, returnBody: null };
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/admin/pos/orders/${orderId}/returns` && request.method() === "POST") {
      state.returnPosts += 1;
      state.returnBody = request.postDataJSON();
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockedResponse(request.url(), request.method())) });
  });
  await check(`${viewport.label} label and receipt previews`, async () => {
    await login(page);
    await openLabels(page);
    await verifyLabelPreview(page, viewport.label);
    if (viewport.label === "desktop") {
      await page.emulateMedia({ media: "print" });
      const labelPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(labelPdf.subarray(0, 4).toString() === "%PDF", "label print output is not a PDF");
      await page.emulateMedia({ media: "screen" });
    }
    await openReceipt(page);
    await verifyReceiptPreview(page, viewport.label);
    if (viewport.label === "desktop") {
      await page.emulateMedia({ media: "print" });
      const receiptPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(receiptPdf.subarray(0, 4).toString() === "%PDF", "receipt print output is not a PDF");
      await page.emulateMedia({ media: "screen" });
    }
    await verifyReturnExchange(page, viewport.label, state);
  });
  await context.close();
}
await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} operations browser check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Operations label and receipt browser print gates passed.");
