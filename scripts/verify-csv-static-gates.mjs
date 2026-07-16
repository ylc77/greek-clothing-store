import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migrationsDirectory = path.join(root, "supabase", "migrations");
const clientInitPath = path.join(root, "supabase", "client-init.sql");
const migrations = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const csvMigrations = migrations.filter((name) => /^\d+_transactional_csv_import_jobs\.sql$/.test(name));

assert.equal(csvMigrations.length, 1, "expected exactly one transactional CSV import migration");
const csvMigration = csvMigrations[0];
const csvMigrationVersion = csvMigration.split("_", 1)[0];
assert.ok(
  BigInt(csvMigrationVersion) > 20260715143949n,
  "transactional CSV import migration must sort after P2 4A product transactions",
);

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
  fs.readFileSync(path.join(migrationsDirectory, name), "utf8"),
  `-- END MIGRATION: ${name}`,
  "",
].join("\n"));
const expectedSnapshot = `${headerLines.join("\n")}\n${snapshotParts.join("\n")}`;
const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const startRoute = read("app/api/admin/products/import/route.ts");
const processRoute = read("app/api/admin/products/import/jobs/[id]/process/route.ts");
const retryRoute = read("app/api/admin/products/import/jobs/[id]/retry/route.ts");
const jobRoute = read("app/api/admin/products/import/jobs/[id]/route.ts");
const errorsRoute = read("app/api/admin/products/import/jobs/[id]/errors.csv/route.ts");
const previewRoute = read("app/api/admin/products/import/preview/route.ts");
const translateRoute = read("app/api/admin/products/import/translate/route.ts");
const importServer = read("lib/csv-import-server.ts");
const parser = read("lib/csv-parser.ts");
const operationIds = read("lib/csv-operation-id.ts");
const exportRoute = read("app/api/admin/backup/route.ts");
const csvOutput = read("lib/csv-output.ts");
const erpInventory = read("lib/erp-inventory.ts");
const dashboard = read("components/admin-dashboard.tsx");
const envExample = read(".env.example");
const migrationSource = read(`supabase/migrations/${csvMigration}`);

for (const [label, source] of [
  ["start/recovery", startRoute],
  ["preview", previewRoute],
  ["translation", translateRoute],
  ["job detail", jobRoute],
  ["job process", processRoute],
  ["job retry", retryRoute],
  ["failed-row download", errorsRoute],
]) {
  assert.match(source, /authorizeAdminRequest/, `${label} route must use normalized authentication`);
  assert.match(source, /["']products:write["']/, `${label} route must require products:write`);
  assert.match(source, /adminAuthorizationFailure|decision\.allowed/, `${label} route must fail closed on authorization denial`);
  assert.match(source, /isFeatureEnabledUncached\(["']csv_import["']\)/, `${label} route must enforce csv_import`);
  assert.match(source, /featureDisabledResponse\(["']csv_import["']\)/, `${label} route must return FEATURE_DISABLED`);
}
assert.match(exportRoute, /authorizeAdminRequest/, "product export must use normalized authentication");
assert.match(exportRoute, /["']backup:read["']/, "product export must require backup:read");
assert.match(exportRoute, /adminAuthorizationFailure/, "product export must fail closed on authorization denial");
assert.match(exportRoute, /isFeatureEnabled\(["']backup_tools["']\)/, "product export must enforce backup_tools");
assert.match(exportRoute, /featureDisabledResponse\(["']backup_tools["']\)/, "product export must return FEATURE_DISABLED");

assert.match(startRoute, /rpc\(\s*["']product_import_start_rpc["']/, "CSV start route must create jobs through start_rpc");
assert.match(importServer, /rpc\(\s*["']product_import_preview_rpc["']/, "CSV preflight must use preview_rpc");
assert.match(importServer, /rpc\(\s*["']product_import_apply_row_rpc["']/, "CSV rows must commit through apply_row_rpc");
assert.match(importServer, /rpc\(\s*["']product_import_refresh_job_rpc["']/, "CSV summaries must use refresh_job_rpc");
for (const [label, source] of [
  ["start", startRoute],
  ["process", processRoute],
  ["retry", retryRoute],
]) {
  assert.match(source, /USE_PRODUCT_RPC/, `${label} route must preserve the P2 4A product RPC boundary`);
  assert.match(source, /USE_CSV_IMPORT_RPC/, `${label} route must enforce USE_CSV_IMPORT_RPC`);
  assert.match(source, /503/, `${label} route must fail closed with HTTP 503`);
  assert.match(source, /CSV_IMPORT_(?:RPC_REQUIRED|RPC_UNAVAILABLE|PROCESSING_UNAVAILABLE|RETRY_UNAVAILABLE)/, `${label} route must return a stable fail-closed code`);
}

const importWriteSurface = [startRoute, processRoute, retryRoute, importServer].join("\n");
assert.doesNotMatch(
  importWriteSurface,
  /\.from\(\s*["'](?:products|product_variants|inventory_balances|stock_movements|product_operations)["']\s*\)/,
  "CSV code must not bypass the preview/apply RPC boundary for product or inventory business tables",
);
assert.doesNotMatch(
  importWriteSurface,
  /syncProductInventoryFromLegacy|syncProductVariantActiveFromLegacy|syncProductVariantActiveState/,
  "CSV code must not retain the historical JavaScript inventory fallback",
);
assert.doesNotMatch(startRoute, /batchTranslateRows|DEEPSEEK/i, "CSV commit route must not call translation or AI");
assert.match(previewRoute, /readProductCsvFormData\(/, "CSV preview must use the same server-side parser as commit");
assert.match(startRoute, /readProductCsvFormData\(/, "CSV commit must parse the uploaded file again on the server");
assert.match(startRoute, /rows:\s*form\.parsed\.rows/, "CSV replay identity must use the frozen user payload");
assert.ok(
  startRoute.indexOf("const existing = await loadProductImportJob") < startRoute.indexOf("preparedRows = await prepareProductImportRows"),
  "CSV route must recover an existing Job before recomputing database concurrency tokens",
);
assert.match(translateRoute, /MAX_TRANSLATION_BODY_BYTES/, "translation preprocessing must cap request bytes");
assert.match(translateRoute, /MAX_TRANSLATION_ROWS/, "translation preprocessing must cap row count");
assert.match(translateRoute, /timeoutMs/, "translation preprocessing must use an explicit timeout");

for (const marker of [
  "CSV_FILE_TOO_LARGE",
  "CSV_TOO_MANY_ROWS",
  "CSV_TOO_MANY_COLUMNS",
  "CSV_CELL_TOO_LONG",
  "CSV_MALFORMED_QUOTES",
  "CSV_DUPLICATE_HEADER",
  "CSV_UNKNOWN_HEADER",
  "CSV_MISSING_REQUIRED_HEADER",
]) assert.match(parser, new RegExp(marker), `strict parser is missing ${marker}`);

assert.match(operationIds, /getOrCreate\(/, "CSV operation store must preserve one business ID");
assert.match(operationIds, /markAttempt\(/, "CSV operation store must distinguish attempted writes");
assert.match(operationIds, /attachJob\(/, "CSV operation store must retain the committed job identity");
assert.match(operationIds, /attemptedAt === null\) return null/, "only an unsubmitted CSV operation may expire locally");
assert.match(dashboard, /CsvImportOperationIdStore|csvImportOperationIds/, "admin CSV flow must use the stable operation ID store");
assert.match(dashboard, /operationId/, "admin CSV request must send the stable operation ID");
assert.match(dashboard, /\/api\/admin\/products\/import\/preview/, "admin CSV flow must call server prevalidation");

assert.match(exportRoute, /buildProductCsvExport/, "backup route must use the complete paginated CSV exporter");
assert.match(exportRoute, /count:\s*["']exact["']/, "CSV export must verify exact table counts");
assert.match(csvOutput, /neutralizeSpreadsheetFormula/, "CSV output must neutralize spreadsheet formulas");
assert.match(csvOutput, /CSV_EXPORT_COUNT_MISMATCH/, "CSV output must reject partial pagination");
assert.match(csvOutput, /["']Cache-Control["']\s*:\s*["']no-store["']/, "CSV downloads must be non-cacheable");

const overviewStart = erpInventory.indexOf("async function loadInventoryOverviewRows");
const overviewEnd = erpInventory.indexOf("export async function getInventoryOverview", overviewStart);
const reconciliationStart = erpInventory.indexOf("export async function getInventoryReconciliation()", overviewEnd);
const reconciliationEnd = erpInventory.indexOf("export async function syncProductVariantActiveFromLegacy", reconciliationStart);
assert.ok(overviewStart >= 0 && overviewEnd > overviewStart, "inventory overview source boundary is missing");
assert.ok(reconciliationStart >= 0 && reconciliationEnd > reconciliationStart, "inventory reconciliation source boundary is missing");
const overviewSource = erpInventory.slice(overviewStart, overviewEnd);
const reconciliationSource = erpInventory.slice(reconciliationStart, reconciliationEnd);
assert.match(overviewSource, /fetchAllSupabaseRows/, "inventory overview must paginate capacity fixtures");
assert.doesNotMatch(overviewSource, /\.in\(\s*["']variant_id["']/, "inventory overview must not build an oversized Variant ID URL");
assert.ok(
  (reconciliationSource.match(/fetchAllSupabaseRows/g) || []).length >= 6,
  "inventory reconciliation must paginate every full-table ledger query",
);
assert.doesNotMatch(
  reconciliationSource,
  /\.in\(\s*["']variant_id["']\s*,\s*allVariantIds\s*\)/,
  "inventory reconciliation must not build an oversized Variant ID URL",
);

assert.match(envExample, /^USE_PRODUCT_RPC=true$/m, ".env.example must keep product RPC enabled");
assert.match(envExample, /^USE_CSV_IMPORT_RPC=true$/m, ".env.example must enable transactional CSV import by default");
assert.match(migrationSource, /app_private\.product_import_authoritative_variants/, "CSV set_inventory must use the authoritative Variant merge helper");
assert.doesNotMatch(
  migrationSource,
  /grant\s+execute\s+on\s+function\s+app_private\.product_import_authoritative_variants[\s\S]{0,100}\s+to\s+(?:public|anon|authenticated|service_role)/i,
  "private Variant merge helper must not be directly executable by API roles",
);
const actualSnapshot = normalizeLineEndings(fs.readFileSync(clientInitPath, "utf8"));
const normalizedExpectedSnapshot = normalizeLineEndings(expectedSnapshot);
if (actualSnapshot !== normalizedExpectedSnapshot) {
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  throw new Error(
    `client-init.sql has drifted from the ordered migration chain (actual ${digest(actualSnapshot)}, expected ${digest(normalizedExpectedSnapshot)}).`,
  );
}

console.log(
  `CSV static gates passed: ${csvMigration} is ordered, client-init is exact, import writes are RPC-only, and export/reconciliation capacity safety is enforced.`,
);
