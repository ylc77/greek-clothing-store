import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const normalizeLineEndings = (value) => value.replace(/\r\n?/g, "\n");
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
const operationsMigrations = migrations.filter((name) => /^\d+_operations_reporting_audit_barcode\.sql$/.test(name));
assert.deepEqual(operationsMigrations, ["20260718105030_operations_reporting_audit_barcode.sql"]);
const projectionMigration = "20260719100000_reconcile_legacy_inventory_projections.sql";
const bulkBarcodeMigration = "20260719120000_transactional_bulk_barcode_generation.sql";
const receiptMigration = "20260904184454_transactional_inventory_receipts.sql";
const returnMigration = "20260905192432_transactional_pos_returns_exchanges.sql";
assert.ok(migrations.includes(projectionMigration), "legacy inventory projection reconciliation migration is missing");
assert.ok(migrations.includes(bulkBarcodeMigration), "bulk Barcode generation migration is missing");
assert.ok(migrations.includes(receiptMigration), "atomic inventory receipt migration is missing");
assert.ok(migrations.includes(returnMigration), "atomic POS return and exchange migration is missing");
assert.ok(
  migrations.indexOf(operationsMigrations[0]) < migrations.indexOf(projectionMigration),
  "legacy inventory projection reconciliation must follow operations reporting",
);
const projectionReconciliation = read(`supabase/migrations/${projectionMigration}`).toLowerCase();
for (const marker of [
  "inventory_balances",
  "main_store",
  "is distinct from",
  "update public.products",
]) assert.ok(projectionReconciliation.includes(marker), `projection reconciliation is missing ${marker}`);

const migration = read(`supabase/migrations/${operationsMigrations[0]}`).toLowerCase();
for (const marker of [
  "europe/athens",
  "pos_day_bounds_rpc",
  "pos_daily_report_rpc",
  "pos_reconciliation_rpc",
  "pos_orders_page_rpc",
  "pos_search_rpc",
  "variant_barcodes_apply_rpc",
  "operations_runtime_health_rpc",
  "security definer",
  "set search_path = ''",
  "pg_advisory_xact_lock",
  "barcode_history_locked",
  "barcode_operations",
  "audit_logs_immutable",
]) assert.ok(migration.includes(marker), `operations migration is missing ${marker}`);
const bulkBarcode = read(`supabase/migrations/${bulkBarcodeMigration}`).toLowerCase();
for (const marker of [
  "variant_barcodes_generate_missing_rpc",
  "security definer",
  "set search_path = ''",
  "pg_advisory_xact_lock",
  "skipped_existing",
  "barcode_already_in_use",
  "jsonb_array_length(p_variant_ids) > 100",
]) assert.ok(bulkBarcode.includes(marker), `bulk Barcode migration is missing ${marker}`);
const receipt = read(`supabase/migrations/${receiptMigration}`).toLowerCase();
for (const marker of [
  "inventory_receipts", "inventory_receipt_items", "inventory_receipt_complete_rpc",
  "security definer", "set search_path = ''", "pg_advisory_xact_lock", "for update",
  "inventory-receipt:", "product_variants_barcode_unique", "quantity_received",
]) assert.ok(receipt.includes(marker), `receipt migration is missing ${marker}`);
assert.match(receipt, /revoke all on function public\.inventory_receipt_complete_rpc[\s\S]*from public, anon, authenticated/);
assert.match(receipt, /grant execute on function public\.inventory_receipt_complete_rpc[\s\S]*to service_role/);
const returns = read(`supabase/migrations/${returnMigration}`).toLowerCase();
for (const marker of [
  "sales_returns", "sales_return_items", "sales_exchanges", "sales_exchange_items",
  "pos_return_exchange_rpc", "security definer", "set search_path = ''",
  "pg_advisory_xact_lock", "for update", "returns_damaged", "returns_quarantine",
  "pos_return:", "pos_exchange:", "expectedbalancedelta",
]) assert.ok(returns.includes(marker), `POS return migration is missing ${marker}`);
assert.match(returns, /revoke execute on function public\.pos_return_exchange_rpc[\s\S]*from public, anon, authenticated/);
assert.match(returns, /grant execute on function public\.pos_return_exchange_rpc[\s\S]*to service_role/);

const receiptRoute = read("app/api/admin/inventory/receipts/route.ts");
assert.match(receiptRoute, /authorizeAdminRequest\(request, permission\)/);
assert.match(receiptRoute, /permission: "inventory:read" \| "inventory:write"/);
assert.match(receiptRoute, /parseInventoryReceiptInput/);
assert.match(receiptRoute, /inventory_receipt_complete_rpc/);
assert.match(receiptRoute, /procurement:cost/);
assert.doesNotMatch(receiptRoute, /from\(["']inventory_balances["']\).*update/s);
const receiptPreviewRoute = read("app/api/admin/inventory/receipts/preview/route.ts");
assert.match(receiptPreviewRoute, /authorizeAdminRequest\(request, "inventory:write"\)/);
assert.match(receiptPreviewRoute, /parseInventoryReceiptInput/);
assert.doesNotMatch(receiptPreviewRoute, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
const receivingWorkspace = read("components/inventory-receiving-workspace.tsx");
assert.match(receivingWorkspace, /InventoryOperationIdStore\("inventory-receipt"/);
assert.match(receivingWorkspace, /receiptRequestFingerprint/);
assert.match(receivingWorkspace, /\/api\/admin\/inventory\/receipts/);
assert.match(receivingWorkspace, /quantityReceived/);
const returnRoute = read("app/api/admin/pos/orders/[id]/returns/route.ts");
assert.match(returnRoute, /authorizeAdminRequest\(request, "pos:void"\)/);
assert.match(returnRoute, /isFeatureEnabled\("pos_void"\)/);
assert.match(returnRoute, /USE_POS_RPC/);
assert.match(returnRoute, /pos_return_exchange_rpc/);
assert.match(returnRoute, /parsePosReturnExchangeInput/);
assert.doesNotMatch(returnRoute, /\.from\(["'](?:sales_returns|sales_return_items|sales_exchanges|sales_exchange_items|inventory_balances|stock_movements)["']\)\.(?:insert|update|upsert|delete)/s);
const returnDialog = read("components/pos-return-exchange-dialog.tsx");
for (const marker of [
  "useBarcodeScanner", "PosOperationIdStore", "posReturnRequestFingerprint",
  "可再次销售", "瑕疵 / 损坏", "隔离待检查", "不是 AADE 税务票据",
  "expectedBalanceDelta", "window.confirm",
]) assert.ok(returnDialog.includes(marker), `POS return dialog is missing ${marker}`);
assert.match(migration, /revoke all on table public\.audit_logs from public, anon, authenticated, service_role/);
assert.match(migration, /grant select on table public\.audit_logs to service_role/);
assert.doesNotMatch(migration, /grant (?:update|delete|insert).*audit_logs.*service_role/);

const dashboard = read("components/admin-dashboard.tsx");
const barcodeFlow = dashboard.slice(dashboard.indexOf("async function generateSelectedBarcodes"), dashboard.indexOf("function openLabelPreview"));
assert.match(barcodeFlow, /productOperationIds\(\)\.getOrCreate/);
assert.match(barcodeFlow, /productOperationIds\(\)\.markAttempt/);
assert.match(barcodeFlow, /clientRequestId:\s*operationId/);
assert.match(barcodeFlow, /productOperationIds\(\)\.complete/);
assert.doesNotMatch(barcodeFlow, /clientRequestId:\s*crypto\.randomUUID/);
assert.match(dashboard, /全选当前结果/);
assert.match(dashboard, /data-barcode-recovery/);
assert.match(dashboard, /allMissingBarcodeCount > 0/);
assert.match(dashboard, /选择当前缺失/);
assert.match(dashboard, /补全已选缺失 Barcode/);
assert.match(dashboard, /确认补全缺失 Barcode/);
const barcodeRoute = read("app/api/admin/variants/generate-barcodes/route.ts");
assert.match(barcodeRoute, /authorizeAdminRequest\(request, "labels:write"\)/);
assert.match(barcodeRoute, /isFeatureEnabled\("barcode_labels"\)/);
assert.match(barcodeRoute, /parseBulkBarcodeRequest/);
assert.match(barcodeRoute, /generateMissingBarcodesForVariants/);
const dailyFlow = dashboard.slice(dashboard.indexOf("async function loadPosDailyReport"), dashboard.indexOf("async function loadPosOrderDetail"));
assert.doesNotMatch(dailyFlow, /timezoneOffsetMinutes|getTimezoneOffset/);
assert.match(dailyFlow, /offset/);
assert.match(dashboard, /posDailyReport\.pagination\.total/);
assert.match(dashboard, /posOrdersTotal/);
assert.match(dashboard, /loadPosOrders\(posOrdersOffset \+ 100\)/);
assert.match(dashboard, /paymentMismatches/);

for (const [file, rpcName] of [
  ["app/api/admin/pos/reports/daily/route.ts", "pos_daily_report_rpc"],
  ["app/api/admin/pos/orders/route.ts", "pos_orders_page_rpc"],
  ["app/api/admin/pos/search/route.ts", "pos_search_rpc"],
  ["app/api/admin/pos/reconciliation/route.ts", "pos_reconciliation_rpc"],
]) {
  const route = read(file);
  assert.match(route, new RegExp(`rpc\\("${rpcName}"`));
  assert.match(route, /503/);
}

const health = read("app/api/admin/pos/health/route.ts");
assert.match(health, /operations_runtime_health_rpc/);
assert.match(health, /pos_reconciliation_rpc/);
const auditRoute = read("app/api/admin/audit/route.ts");
assert.match(auditRoute, /authorizeAdminRequest\(request, "backup:read"\)/);
assert.match(auditRoute, /adminPrivateJson/);

const categoryLoader = read("lib/products.ts");
assert.match(categoryLoader, /\.range\(offset, offset \+ limit - 1\)/);
assert.doesNotMatch(categoryLoader, /getProductsByCategoryRaw[\s\S]*?\.limit\(200\)/);
assert.match(read("components/category-page.tsx"), /hasNextPage/);
assert.match(read("app/[category]/page.tsx"), /searchParams/);
assert.doesNotMatch(read("app/api/admin/pos/search/route.ts"), /1000/);
assert.doesNotMatch(read("app/api/admin/pos/orders/route.ts"), /\.limit\(500\)/);

for (const file of ["components/label-print-preview.tsx", "components/pos-receipt-preview.tsx"]) {
  const preview = read(file);
  assert.match(preview, /PrintLanguage/);
  assert.doesNotMatch(preview, /clothing store/i);
}
assert.match(read("components/pos-receipt-preview.tsx"), /notTaxInvoice/);
assert.match(read("components/label-print-preview.tsx"), /@page/);

const csvRoute = read("app/api/admin/backup/route.ts");
assert.match(csvRoute, /X-Export-Purpose.*maintenance-csv/i);
assert.match(csvRoute, /X-Disaster-Recovery.*false/i);
const backup = read("scripts/customer-backup.ts");
const restore = read("scripts/customer-restore.ts");
const common = read("scripts/customer-backup-common.ts");
for (const marker of ["--project-ref", "--output", "manifest.json", "sha256", "listBuckets", "db", "dump"]) assert.match(backup, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
for (const marker of ["SUPABASE_DB_URL", "postgres:17-alpine", "target database is not empty", "target Storage already contains objects", "verifyCustomerBackup", "RESTORE"]) assert.match(restore, new RegExp(marker));
assert.doesNotMatch(backup + restore + common, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/);
assert.match(read(".gitignore"), /^backups\/$/m);

const headerLines = [
  "-- Clothing Store - new customer Supabase initialization",
  "-- AUTHORITATIVE NEW CUSTOMER DEPLOYMENT SNAPSHOT.",
  "-- Run this file only in a brand-new, empty Supabase project.",
  "-- For customer deployment: paste the whole file into Supabase SQL Editor and click Run once.",
  "-- For development and upgrades: supabase/migrations remains the source of truth.",
  "-- Do not run this file on an existing customer database.",
  "-- Generated from the ordered migrations listed below.",
  "",
];
const snapshotParts = migrations.map((name) => [
  "-- ============================================================================",
  `-- BEGIN MIGRATION: ${name}`,
  "-- ============================================================================",
  read(`supabase/migrations/${name}`),
  `-- END MIGRATION: ${name}`,
  "",
].join("\n"));
assert.equal(
  normalizeLineEndings(read("supabase/client-init.sql")),
  normalizeLineEndings(`${headerLines.join("\n")}\n${snapshotParts.join("\n")}`),
  "client-init.sql drifted from migrations",
);

console.log(`Operations static gates passed for ${migrations.length} ordered migrations.`);
