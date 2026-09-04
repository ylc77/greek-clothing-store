/* eslint-disable no-console */
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function mockedResponse(url, role, featureOverrides = {}) {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/admin/session") return { ok: true, role, permissions: rolePermissions[role], authType: "password", displayName: `Navigation ${role}` };
  if (pathname === "/api/admin/features") return { ok: true, settings: { plan: "advanced", features: { ...features, ...featureOverrides }, configured: true } };
  if (pathname === "/api/admin/categories") return { ok: true, categories: [], subcategories: [] };
  if (pathname === "/api/admin/suppliers") return { ok: true, suppliers: [] };
  if (pathname === "/api/admin/products") return { ok: true, products: [], total: 0 };
  if (pathname === "/api/admin/inventory/reconciliation") return { ok: true, runtimeHealth: { ready: true }, ...Object.fromEntries(["stockVsBalanceMismatches", "sizeStockMismatches", "productsWithoutVariants", "variantsWithoutMainStoreBalance", "duplicateVariantSkus", "duplicateBarcodes", "reservedExceedsOnHand", "blankMovementReasons", "negativeBalances", "duplicateOperationKeys", "movementDeltaMismatches", "movementContinuityMismatches", "balanceVsLatestMovementMismatches", "balancesWithoutMovements", "operationsMissingMovements"].map(key => [key, []])) };
  if (pathname === "/api/admin/inventory") return { ok: true, items: [], total: 0 };
  if (pathname === "/api/admin/online-orders") return { ok: true, orders: [] };
  if (pathname === "/api/admin/pos/health") return { ok: true, ready: true, runtimeHealth: { ready: true } };
  if (pathname === "/api/admin/pos/orders") return { ok: true, orders: [], total: 0, limit: 100, offset: 0 };
  return { ok: true };
}

async function openAdmin(page, role, featureOverrides = {}, calls = [], reply) {
  await page.route("**/api/admin/**", async (route) => {
    calls.push({ path: new URL(route.request().url()).pathname, method: route.request().method() });
    const response = reply?.(route.request());
    await route.fulfill({ status: response?.status || 200, contentType: "application/json", body: JSON.stringify(response?.body || mockedResponse(route.request().url(), role, featureOverrides)) });
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


async function navigate(page, key, compact) {
  if (compact) await page.getByRole("button", { name: /^菜单 ·/ }).click();
  await page.locator('[data-admin-section="' + key + '"]:visible').click();
  if (compact) await page.getByRole("dialog").waitFor({state:"hidden"});
}
async function primaryKeys(page, compact) {
  if (compact) await page.getByRole("button", { name: /^菜单 ·/ }).click();
  const keys = await page.locator("[data-admin-section]:visible").evaluateAll(nodes => nodes.map(node => node.dataset.adminSection));
  if (compact) {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({state:"hidden"});
  }
  return keys;
}
async function verify(browser, role, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [], calls = [];
  page.on("pageerror", error => errors.push(error.message));
  const compact = viewport.width < 1280;
  try {
    await openAdmin(page, role, {}, calls);
    const defaultHeading = role === "inventory" ? "到货入库" : role === "staff" && !compact ? "POS 扫码" : "工作台";
    await page.getByRole("heading", {name: defaultHeading, exact:true}).waitFor();
    await navigate(page, "workspace", compact);
    if (role === "owner") await page.screenshot({path:join(tmpdir(), `clothing-admin-workspace-${viewport.width}.png`),fullPage:true});
    const menus = {
      owner: ["workspace", "pos", "receiving", "catalog", "orders", "more"],
      staff: ["workspace", "pos", "catalog", "orders"],
      inventory: ["workspace", "receiving", "catalog", "orders", "more"],
      readonly: ["workspace", "catalog", "orders"],
    }[role].filter(key => !compact || key !== "pos");
    expect(JSON.stringify(await primaryKeys(page, compact)) === JSON.stringify(menus), role + " primary menu mismatch");
    expect(await page.locator("[data-workspace-action]").count() <= 6, "too many shortcuts");
    expect(await page.locator('[data-workspace-action="quickSale"]').count() === 0, "emergency deduction is a shortcut");
    await navigate(page, "catalog", compact);
    expect(await page.locator("[data-admin-secondary] button").count() <= 3, "catalog exceeded three subtabs");
    const options = await page.locator("select").filter({has: page.locator('option[value="incomplete"]')}).locator("option").allTextContents();
    for (const label of ["资料不完整", "缺图", "缺译文", "无库存", "已下架"]) expect(options.includes(label), "missing product filter " + label);
    await page.locator("[data-admin-secondary]").getByRole("button", {name:"库存",exact:true}).click();
    expect(await page.locator('[data-admin-secondary] button[aria-pressed="true"]').innerText() === "库存", "inventory tab is not marked active");
    await page.getByRole("heading",{name:"库存快速查询",exact:true}).waitFor();
    await page.locator("[data-inventory-history]").waitFor();
    expect(await page.locator("[data-inventory-history]").getAttribute("open") === null, "history expanded by default");
    expect(await page.locator("[data-inventory-diagnostics]").count() === (role === "owner" ? 1 : 0), "diagnostic role boundary");
    if (role !== "owner") {
      expect(!calls.some(call => call.path.endsWith("/reconciliation")), "employee requested diagnostics");
      expect(await page.getByText("成本 / 补货", {exact:true}).count() === 0, "cost exposed");
    }
    if (role === "owner" || role === "inventory") {
      await page.locator("[data-admin-secondary]").getByRole("button",{name:"盘点",exact:true}).click();
      await page.getByRole("heading",{name:"盘点",exact:true}).waitFor();
      expect(await page.getByRole("button",{name:"到货扫码",exact:true}).count() === 0, "stocktake exposes receiving mode");
      await navigate(page,"receiving",compact);
      await page.getByRole("heading",{name:"到货入库",exact:true}).waitFor();
      expect(await page.locator("[data-admin-secondary]").count() === 0, "receiving has mode tabs");
    }
    await navigate(page,"orders",compact);
    expect(await page.locator("[data-admin-secondary] button").count() <= 3,"orders exceeded three subtabs");
    if (role === "owner" || role === "staff") {
      const source = page.getByLabel("订单来源",{exact:true});
      await source.selectOption("online");
      await page.getByRole("heading",{name:"在线订单",exact:true}).waitFor();
      expect(await page.getByRole("heading",{name:"POS 订单历史",exact:true}).count() === 0,"online source shows POS");
      await source.selectOption("store");
      await page.getByRole("heading",{name:"POS 订单历史",exact:true}).waitFor();
      expect(await page.getByRole("heading",{name:"在线订单",exact:true}).count() === 0,"store source shows online");
    }
    await page.locator("[data-admin-secondary]").getByRole("button",{name:"退货换货",exact:true}).click();
    await page.getByRole("heading",{name:"退货换货",exact:true}).waitFor();
    expect(await page.getByText(/库存加回不等于退款/).count() === 1,"refund boundary warning absent");
    if (menus.includes("more")) {
      await navigate(page,"more",compact);
      expect(await page.locator('[data-admin-management-group="system"]').count() === (role === "owner" ? 1 : 0),"system tools boundary");
      if (role === "owner") {
        await page.locator('[data-admin-management-group="system"] summary').click();
        await page.locator('[data-admin-tool="quickSale"]').click();
        await page.getByRole("heading",{name:"库存紧急扣减",exact:true}).waitFor();
      }
    }
    if (role === "owner" && !compact) {
      await navigate(page,"pos",false);
      await page.getByRole("heading",{name:"POS 扫码",exact:true}).waitFor();
      await page.setViewportSize({width:768,height:1000});
      await page.getByRole("heading",{name:"工作台",exact:true}).waitFor();
      expect(!(await primaryKeys(page,true)).includes("pos"),"resize retained compact POS entry");
      await page.setViewportSize(viewport);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow <= 1, role + " " + viewport.width + " overflow " + overflow);
    expect(errors.length === 0, "browser errors: " + errors.join(";"));
    expect(calls.every(call => call.method === "GET" || call.path === "/api/admin/session"),"navigation caused a business write");
    console.log("PASS " + role + " " + viewport.width + " navigation / permissions / modes / overflow");
  } finally { await context.close(); }
}
async function verifyContextLabels(browser) {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const writes = [];
  let fail = true;
  const product = {id:1,sku:"NAV-FIXTURE",name_cn:"导航测试商品",name_en:"Navigation fixture",name_gr:"Fixture",description_cn:"说明",description_en:"Description",description_gr:"Description",category:"men",subcategory:"shirts",price:20,stock:20,size_stock:{M:20},sizes:"M",size_system:"letter",image_url:"",image_urls:[],is_active:true,colors:[],created_at:"2026-01-01T00:00:00Z"};
  const item = {product_id:1,product_name:product.name_cn,product_sku:product.sku,category:"men",subcategory:"shirts",variant_id:"11111111-1111-4111-8111-111111111111",variant_sku:"NAV-FIXTURE-M",barcode:"NAV-FIXTURE-M",size:"M",color:null,price:20,active:true,quantity_on_hand:20,quantity_available:20,quantity_reserved:0,stock_matches_legacy:true,size_stock_matches_legacy:true,cost_price:7,reorder_level:3};
  try {
    await openAdmin(page,"owner",{},[],request => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/admin/products") return {body:{ok:true,products:[product],total:1}};
      if (path === "/api/admin/inventory") return {body:{ok:true,items:[item],total:1}};
      if (path === "/api/admin/inventory/adjust") {
        writes.push(request.postDataJSON());
        return fail ? {status:503,body:{error:"测试：结果未知，请使用原操作重试"}} : {body:{ok:true,quantityBefore:20,quantityAfter:23,noChange:false}};
      }
    });
    await navigate(page,"catalog",false);
    await page.screenshot({path:join(tmpdir(), "clothing-admin-catalog-context.png"),fullPage:true});
    await page.getByRole("button",{name:"打印标签",exact:true}).filter({visible:true}).click();
    await page.getByRole("heading",{name:/标签打印/}).waitFor();
    expect(await page.getByText("预计打印：1 张",{exact:true}).count() === 1,"product labels used total stock instead of one per variant");
    await navigate(page,"receiving",false);
    const lookup = page.getByPlaceholder("扫描条码，或输入商品 SKU / 供货商 SKU / 款号 / 商品名");
    await lookup.fill(item.barcode);
    await page.getByRole("button",{name:"查找商品",exact:true}).click();
    await page.getByPlaceholder("填写本次增加件数").fill("3");
    await page.getByRole("button",{name:"检查并到货扫码",exact:true}).click();
    await page.getByRole("button",{name:"确认到货扫码",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"测试：结果未知"}).waitFor();
    expect(await page.getByRole("button",{name:"打印本次标签",exact:true}).count() === 0,"failed receiving offered success labels");
    fail = false;
    await page.getByRole("button",{name:"检查并到货扫码",exact:true}).click();
    await page.getByRole("button",{name:"确认到货扫码",exact:true}).click();
    await page.getByRole("button",{name:"打印本次标签",exact:true}).click();
    expect(writes.length === 2 && writes[0].clientRequestId === writes[1].clientRequestId,"receiving retry changed the business ID");
    expect(writes[1].quantity === 3 && writes[1].mode === "adjust_by","receiving changed the inventory request contract");
    await page.locator(".label-print-root .label-page").first().waitFor();
    expect(await page.locator(".label-print-root .label-page").count() === 3, "receiving preview used total stock instead of increment");
    await page.getByText("设备与打印设置", {exact:true}).click();
    await page.getByLabel("显示售价", {exact:true}).uncheck();
    expect(await page.locator("[data-label-price]").count() === 0, "hidden prices remain on printed labels");
    await page.getByRole("spinbutton", {name:"水平偏移",exact:true}).fill("1.5");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("clothing.label-print-profile.v1")).offsetX) === 1.5, "print preference was not stored locally");
    await page.getByLabel("显示售价", {exact:true}).check();
    await page.getByRole("button", {name:"校准页",exact:true}).click();
    expect(await page.locator('svg[data-barcode="PT1509-TEST"]').count() === 1, "calibration barcode missing");
    await page.getByRole("button", {name:"返回商品标签",exact:true}).click();
    expect(await page.locator(".label-print-root .label-page").count() === 3, "calibration altered queued copies");
    await page.locator(".label-no-print").getByRole("button", {name:"关闭",exact:true}).click();
    expect(await page.getByRole("button",{name:"打印本次标签",exact:true}).count() === 1,"closing preview marked labels printed");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button",{name:"确认实物已打印",exact:true}).click();
    expect(await page.getByRole("button",{name:"打印本次标签",exact:true}).count() === 1,"cancelled confirmation lost queued labels");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button",{name:"确认实物已打印",exact:true}).click();
    await page.locator("[data-label-print-confirmation]").waitFor();
    expect((await page.locator("[data-label-print-confirmation]").innerText()).includes("3 张"),"physical confirmation did not record actual queue count");
    expect(await page.getByRole("button",{name:"打印本次标签",exact:true}).count() === 0,"confirmed print kept pending labels");
    expect(writes.length === 2,"print confirmation unexpectedly wrote inventory");
    console.log("PASS contextual product labels / receiving labels / failed result / retry ID / physical confirmation");
  } finally { await context.close(); }
}
async function verifyScanner(browser) {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const searches = [];
  const item = {variant_id:"11111111-1111-4111-8111-111111111111",product_id:1,product_sku:"TEST",variant_sku:"TEST-M",barcode:"TEST123",name:"Scanner Test",size:"M",color:null,price:10,quantity_available:3,quantity_on_hand:3,quantity_reserved:0,product_active:true,variant_active:true,outOfStock:false};
  try {
    await openAdmin(page,"staff",{},[],request => {
      const url = new URL(request.url());
      if (url.pathname === "/api/admin/pos/search") {
        const q = url.searchParams.get("q"); searches.push(q);
        return {body:{ok:true,items:q === item.barcode ? [item] : [],total:q === item.barcode ? 1 : 0}};
      }
    });
    const input = page.getByPlaceholder("扫码 / 输入 barcode、variant SKU、商品 SKU 或商品名");
    await input.waitFor();
    expect(await input.evaluate(node => node === document.activeElement), "POS did not autofocus");
    const scan = async code => { await input.pressSequentially(code,{delay:5}); await input.press("Enter"); };
    await scan(item.barcode);
    const quantity = page.locator('aside input[type="number"][min="1"]');
    await page.waitForFunction(() => document.querySelector('aside input[type="number"][min="1"]')?.value === "1");
    await scan(item.barcode);
    await page.waitForFunction(() => document.querySelector('aside input[type="number"][min="1"]')?.value === "2");
    expect(searches.length === 2, "one scan submitted multiple searches");
    await scan("INVALID123");
    await page.getByText("没有找到商品，请检查条码、SKU 或商品名。",{exact:true}).waitFor();
    expect(await input.evaluate(node => node === document.activeElement), "invalid code lost scanner focus");
    expect(await quantity.inputValue() === "2", "invalid barcode changed the cart");
    await input.fill("");
    await input.pressSequentially("manual",{delay:120});
    expect(searches.length === 3, "slow manual input triggered scanner search");
    console.log("PASS scanner exact-match / repeated quantity / invalid focus / manual typing / single request per scan");
  } finally { await context.close(); }
}
const browser = await chromium.launch({headless:true});
try {
  for (const width of [390,768,1440]) for (const role of ["owner","staff","inventory","readonly"]) await verify(browser,role,{width,height:1000});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  await openAdmin(page,"owner", {pos_checkout:false,pos_orders:false,pos_reports:false,online_orders:false,inventory:false,barcode_labels:false,quick_sell:false});
  expect(JSON.stringify(await primaryKeys(page,false)) === JSON.stringify(["workspace","catalog","more"]), "disabled features still appear");
  await navigate(page,"more",false);
  expect(await page.locator('[data-admin-tool="quickSale"]').count() === 0,"disabled emergency tool exists");
  expect(await page.locator('[data-admin-tool="labels"]').count() === 0,"disabled labels tool exists");
  await context.close();
  console.log("PASS disabled feature navigation");
  await verifyContextLabels(browser);
  await verifyScanner(browser);
} finally { await browser.close(); }
console.log("Admin navigation browser checks passed (mock API, no real business writes).");
