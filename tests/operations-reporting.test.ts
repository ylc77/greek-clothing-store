import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// @ts-ignore Node's strip-only test runner requires the explicit .ts extension.
import { ATHENS_TIME_ZONE, formatAthensBusinessDate, formatAthensDateTime, localizedPrintCopy, localizedPrintProductName, normalizeLabelCopies } from "../lib/operations-print.ts";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Athens print timestamps stay on the business timezone across winter and summer", () => {
  assert.equal(ATHENS_TIME_ZONE, "Europe/Athens");
  assert.equal(formatAthensDateTime("2026-01-15T20:30:00.000Z", "el"), "15/01/2026, 22:30");
  assert.equal(formatAthensDateTime("2026-07-15T20:30:00.000Z", "en"), "15/07/2026, 23:30");
  assert.equal(formatAthensBusinessDate("2026-07-15T22:30:00.000Z"), "2026-07-16");
});

test("feature settings failures visibly and actually fall back to Basic", () => {
  const page = source("app/admin/page.tsx");
  const dashboard = source("components/admin-dashboard.tsx");
  assert.match(page, /initialFeatureSettingsConfigured=\{featureSettings\.configured\}/);
  assert.match(dashboard, /setAdminFeatures\(defaultAdminFeatures\)/);
  assert.match(dashboard, /当前使用基础功能设置；如需调整，请联系维护人员/);
});

test("print copy and product snapshots are Greek or English, never internal Chinese", () => {
  assert.match(localizedPrintCopy("el").receiptTitle, /Απόδειξη/);
  assert.match(localizedPrintCopy("en").notTaxInvoice, /not a tax receipt or tax invoice/i);
  assert.equal(localizedPrintProductName({ name: "内部中文名", name_en: "Dress", name_gr: "Φόρεμα" }, "el"), "Φόρεμα");
  assert.equal(localizedPrintProductName({ name: "内部中文名", name_en: "Dress", name_gr: "Φόρεμα" }, "en"), "Dress");
  assert.equal(localizedPrintProductName({ name: "内部中文名", name_en: "", name_gr: "" }, "el"), "-");
});

test("label copy counts are bounded, integral and derived from actual stock", () => {
  assert.equal(normalizeLabelCopies(3, 9), 3);
  assert.equal(normalizeLabelCopies(undefined, 9), 9);
  assert.equal(normalizeLabelCopies(99_999, 2), 500);
  assert.equal(normalizeLabelCopies(-2, 8), 1);
});

test("POS reporting and search routes use database RPCs without fixed 500 or 1000 row truncation", () => {
  const daily = source("app/api/admin/pos/reports/daily/route.ts");
  const orders = source("app/api/admin/pos/orders/route.ts");
  const search = source("app/api/admin/pos/search/route.ts");

  assert.match(daily, /rpc\("pos_daily_report_rpc"/);
  assert.doesNotMatch(daily, /timezoneOffsetMinutes/);
  assert.match(orders, /rpc\("pos_orders_page_rpc"/);
  assert.doesNotMatch(orders, /\.limit\(500\)/);
  assert.match(search, /rpc\("pos_search_rpc"/);
  assert.doesNotMatch(search, /fetchLimit\s*=\s*q\s*\?\s*1000/);
});

test("public category browsing is paginated instead of silently stopping at 200 products", () => {
  const products = source("lib/products.ts");
  const category = source("components/category-page.tsx");
  assert.doesNotMatch(products, /getProductsByCategoryRaw[\s\S]*?\.limit\(200\)/);
  assert.match(products, /\.range\(offset, offset \+ limit - 1\)/);
  assert.match(category, /hasNextPage/);
});

test("print previews require configured branding and expose GR or EN output", () => {
  const labels = source("components/label-print-preview.tsx");
  const receipt = source("components/pos-receipt-preview.tsx");
  assert.doesNotMatch(labels, /storeName\s*=\s*"clothing store"/);
  assert.doesNotMatch(receipt, /"clothing store"/);
  assert.match(labels, /language:\s*PrintLanguage/);
  assert.match(receipt, /language:\s*PrintLanguage/);
  assert.match(receipt, /notTaxInvoice/);
});

test("the browser CSV endpoint is explicitly a maintenance export, not disaster recovery", () => {
  const route = source("app/api/admin/backup/route.ts");
  const dashboard = source("components/admin-dashboard.tsx");
  assert.match(route, /X-Export-Purpose.*maintenance-csv/i);
  assert.match(route, /X-Disaster-Recovery.*false/i);
  assert.match(dashboard, /导出商品资料 CSV（非完整备份）/);
  assert.match(dashboard, /不能恢复数据库或图片/);
});
