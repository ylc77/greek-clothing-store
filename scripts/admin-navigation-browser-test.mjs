/* eslint-disable no-console */
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const rolePermissions = {
  owner: [
    "products:read", "products:write", "products:delete", "inventory:read", "inventory:write",
    "pos:read", "pos:checkout", "pos:void", "labels:write", "categories:write", "feed:read",
    "backup:read", "ai:write", "procurement:read", "procurement:cost", "procurement:write",
    "online_orders:read", "online_orders:write",
  ],
  staff: ["products:read", "inventory:read", "pos:read", "pos:checkout", "feed:read", "online_orders:read", "online_orders:write"],
  inventory: ["products:read", "inventory:read", "inventory:write", "labels:write", "feed:read", "procurement:read"],
  readonly: ["products:read", "inventory:read", "pos:read", "feed:read"],
};

const features = {
  storefront: true,
  product_management: true,
  inventory: true,
  quick_sell: true,
  pos_checkout: true,
  pos_orders: true,
  pos_void: true,
  pos_reports: true,
  receipt_printing: true,
  barcode_labels: true,
  csv_import: true,
  online_orders: true,
  staff_accounts: true,
  ai_tools: true,
  backup_tools: true,
};

function mockedResponse(url, role) {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/admin/session") return { ok: true, role, permissions: rolePermissions[role], authType: "password", displayName: `Navigation ${role}` };
  if (pathname === "/api/admin/features") return { ok: true, settings: { plan: "advanced", features, configured: true } };
  if (pathname === "/api/admin/categories") return { ok: true, categories: [], subcategories: [] };
  if (pathname === "/api/admin/suppliers") return { ok: true, suppliers: [] };
  if (pathname === "/api/admin/products") return { ok: true, products: [], total: 0 };
  if (pathname === "/api/admin/inventory") return { ok: true, items: [], total: 0 };
  if (pathname === "/api/admin/online-orders") return { ok: true, orders: [] };
  if (pathname === "/api/admin/pos/health") return { ok: true, ready: true, runtimeHealth: { ready: true } };
  if (pathname === "/api/admin/pos/orders") return { ok: true, orders: [], total: 0, limit: 100, offset: 0 };
  return { ok: true };
}

async function openAdmin(page, role) {
  await page.route("**/api/admin/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockedResponse(route.request().url(), role)) });
  });
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  if (!(await page.locator("header").count())) {
    const emergencyMode = page.getByRole("button", { name: "应急密码", exact: true });
    if (await emergencyMode.count()) await emergencyMode.click();
    await page.locator("#admin-emergency-password").fill("Browser-only mocked credential");
    await page.locator("form button").last().click();
  }
  await page.locator("header").waitFor();
}

async function visibleTabKeys(page, scope) {
  return page.locator(`${scope} [data-admin-tab]:visible`).evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-admin-tab"))
  ));
}

async function verifyOwnerViewport(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await openAdmin(page, "owner");
    const expectedCommonTabs = ["onlineOrders", "stockLookup", "stockOperations", "quickAdd", "dashboard"];
    if (viewport.label === "desktop") expectedCommonTabs.push("pos");
    const commonTabs = await visibleTabKeys(page, "[data-admin-common-tabs]");
    expect(JSON.stringify(commonTabs) === JSON.stringify(expectedCommonTabs), `${viewport.label} common tabs were ${commonTabs.join(", ")}`);

    const customizer = page.locator("[data-admin-customize-toggle]");
    await customizer.click();
    const moveDashboardForward = page.getByLabel("将商品管理向后移动", { exact: true });
    expect(await moveDashboardForward.count() === 1, `${viewport.label} product shortcut reorder control is missing`);
    expect((await moveDashboardForward.isEnabled()) === (viewport.label === "desktop"), `${viewport.label} product shortcut reorder boundary is incorrect`);
    await customizer.click();

    const managementTools = page.locator("[data-admin-management-tools]");
    await managementTools.locator("summary").click();
    const visibleGroups = await managementTools.locator("[data-admin-management-group]:visible").evaluateAll((elements) => (
      elements.map((element) => ({
        key: element.getAttribute("data-admin-management-group"),
        actions: Array.from(element.querySelectorAll("button")).filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
      }))
    ));
    const expectedGroups = viewport.label === "desktop"
      ? ["inventory", "sales", "catalog", "batch"]
      : ["inventory", "sales", "catalog"];
    expect(JSON.stringify(visibleGroups.map((group) => group.key)) === JSON.stringify(expectedGroups), `${viewport.label} management groups were ${visibleGroups.map((group) => group.key).join(", ")}`);
    expect(visibleGroups.every((group) => group.actions > 0), `${viewport.label} rendered an empty management group`);

    const stockOperations = page.locator('[data-admin-common-tabs] [data-admin-tab="stockOperations"]:visible');
    expect(await stockOperations.count() === 1, `${viewport.label} has no unique receiving shortcut`);
    await stockOperations.click();
    const stockOperationPanel = page.locator("section.admin-panel").filter({ hasText: "扫码库存作业" });
    const receivingMode = stockOperationPanel.getByRole("button", { name: /到货扫码/ });
    expect(await receivingMode.count() === 1, `${viewport.label} receiving mode is missing`);
    expect((await receivingMode.getAttribute("class") || "").includes("bg-ink"), `${viewport.label} receiving shortcut did not activate receiving mode`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow <= 1, `${viewport.label} admin navigation causes ${overflow}px root overflow`);

    if (viewport.label === "desktop") {
      const posShortcut = page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]:visible');
      expect(await posShortcut.count() === 1, "desktop POS shortcut is missing");
      await posShortcut.click();
      await page.getByRole("heading", { name: "POS 扫码", exact: true }).waitFor();
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.getByRole("heading", { name: "在线订单", exact: true }).waitFor();
      expect(await page.locator('[data-admin-common-tabs] [data-admin-tab="pos"]:visible').count() === 0, "tablet viewport retained the POS shortcut");
      expect(await page.locator('[data-admin-management-group="batch"]:visible').count() === 0, "tablet viewport retained batch tools");
    }
    console.log(`PASS ${viewport.label} owner navigation`);
  } finally {
    await context.close();
  }
}

async function verifyRoleDefaults(browser, role, expectedTabs, forbiddenTabs) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openAdmin(page, role);
    const commonTabs = await visibleTabKeys(page, "[data-admin-common-tabs]");
    expect(JSON.stringify(commonTabs) === JSON.stringify(expectedTabs), `${role} common tabs were ${commonTabs.join(", ")}`);
    for (const tab of forbiddenTabs) {
      expect(await page.locator(`[data-admin-tab="${tab}"]`).count() === 0, `${role} can see forbidden ${tab} entry`);
    }
    console.log(`PASS ${role} role navigation`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 390, height: 844, label: "mobile" },
    { width: 768, height: 1024, label: "tablet" },
    { width: 1440, height: 1000, label: "desktop" },
  ]) {
    await verifyOwnerViewport(browser, viewport);
  }
  await verifyRoleDefaults(browser, "staff", ["onlineOrders", "stockLookup", "dashboard", "pos"], ["quickAdd", "categories", "labels"]);
  await verifyRoleDefaults(browser, "inventory", ["stockOperations", "stockLookup", "labels", "inventory"], ["pos", "onlineOrders", "quickAdd"]);
  await verifyRoleDefaults(browser, "readonly", ["stockLookup", "dashboard", "posOrders"], ["stockOperations", "quickAdd", "labels"]);
} finally {
  await browser.close();
}

console.log("Admin navigation browser checks passed.");
