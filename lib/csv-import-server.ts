import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyProductCsvTranslations,
  parseAndNormalizeProductCsv,
  type NormalizedProductImportRow,
  type NormalizedProductImportVariant,
  type ProductCsvImportMode,
  type ProductCsvInventoryMode,
} from "@/lib/csv-import";
import {
  CsvInputError,
  PRODUCT_CSV_LIMITS,
  readRequestBytesWithLimit,
} from "@/lib/csv-parser";

export const CSV_IMPORT_SCHEMA_VERSION = 1;
export const CSV_IMPORT_PROCESS_CHUNK = 25;
export const CSV_IMPORT_MULTIPART_LIMIT = PRODUCT_CSV_LIMITS.maxFileBytes + 256 * 1024;

type JsonObject = Record<string, unknown>;

type ExistingProduct = JsonObject & {
  id: number | string;
  sku: string;
  metadata_version: number | string;
  structure_version: number | string;
  variants?: ExistingVariant[];
};

type ExistingVariant = JsonObject & {
  id: string;
  variant_sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  quantity_on_hand: number | string;
  quantity_reserved: number | string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function sha256Hex(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export function stablePayloadHash(value: unknown) {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

export async function productImportRuntimeReady(supabase: SupabaseClient) {
  try {
    const { data, error } = await (supabase as any).rpc("product_import_runtime_health_rpc");
    return !error && data?.ready === true;
  } catch {
    return false;
  }
}

function normalizedIdentity(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function variantIdentity(value: Pick<NormalizedProductImportVariant, "size" | "color">) {
  return `${String(value.size || "ONE SIZE").trim().toUpperCase()}\u0000${normalizedIdentity(value.color)}`;
}

function mergeExistingVariantIdentity(
  imported: NormalizedProductImportVariant,
  existingVariants: ExistingVariant[],
) {
  const existing = existingVariants.find((variant) => (
    normalizedIdentity(variant.variant_sku) === normalizedIdentity(imported.variant_sku)
    || variantIdentity({ size: String(variant.size || "ONE SIZE"), color: String(variant.color || "") })
      === variantIdentity(imported)
  ));
  if (!existing) return imported;
  return {
    ...imported,
    id: existing.id,
    variant_sku: existing.variant_sku,
    barcode: imported.barcode || existing.barcode,
    expected_on_hand: Number(existing.quantity_on_hand || 0),
  };
}

export async function prepareProductImportRows(
  supabase: SupabaseClient,
  rows: NormalizedProductImportRow[],
  options: { importMode: ProductCsvImportMode; inventoryMode: ProductCsvInventoryMode },
) {
  const { data, error } = await (supabase as any).rpc("product_import_preview_rpc", {
    p_normalized_skus: rows.map((row) => row.normalizedSku),
  });
  if (error || !Array.isArray(data)) {
    throw new Error("CSV_IMPORT_RPC_UNAVAILABLE");
  }
  const existingBySku = new Map<string, ExistingProduct>(
    data.map((product: ExistingProduct) => [normalizedIdentity(product.sku), product]),
  );

  const preparedRows = rows.map((row) => {
    const existing = existingBySku.get(row.normalizedSku);
    const resolvedAction = options.importMode === "create_only"
      ? "create"
      : options.importMode === "update_existing"
        ? "update"
        : existing
          ? "update"
          : "create";
    const variants = existing && options.inventoryMode === "set_inventory"
      ? row.variants.map((variant) => mergeExistingVariantIdentity(variant, existing.variants || []))
      : row.variants;
    const frozen = {
      row_number: row.rowNumber,
      normalized_sku: row.normalizedSku,
      metadata: row.metadata,
      variants,
      resolved_action: resolvedAction,
      expected_product_id: existing ? Number(existing.id) : null,
      expected_metadata_version: existing ? Number(existing.metadata_version) : null,
      expected_structure_version: existing ? Number(existing.structure_version) : null,
    };
    return { ...frozen, row_hash: stablePayloadHash(frozen) };
  });
  return preparedRows;
}

function mode(value: FormDataEntryValue | null, allowed: readonly string[], fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : fallback;
  if (!allowed.includes(normalized)) {
    throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", `Invalid CSV import mode: ${normalized}`);
  }
  return normalized;
}

export async function readProductCsvFormData(
  request: Request,
  options: { requireOperationId?: boolean } = {},
) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", "CSV requests must use multipart/form-data.");
  }
  const multipartBytes = await readRequestBytesWithLimit(request, CSV_IMPORT_MULTIPART_LIMIT);
  const form = await new Response(multipartBytes, {
    headers: { "content-type": contentType },
  }).formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    throw new CsvInputError("CSV_EMPTY_FILE", "A CSV file is required.");
  }
  if (file.size > PRODUCT_CSV_LIMITS.maxFileBytes) {
    throw new CsvInputError("CSV_FILE_TOO_LARGE", "CSV file exceeds the configured limit.");
  }
  const importMode = mode(form.get("importMode"), ["create_only", "update_existing", "upsert"], "create_only") as ProductCsvImportMode;
  const inventoryMode = mode(form.get("inventoryMode"), ["metadata_only", "set_inventory"], "metadata_only") as ProductCsvInventoryMode;
  const operationId = String(form.get("operationId") || "").trim();
  if (options.requireOperationId && (!operationId || operationId.length > 200)) {
    throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", "A stable operationId is required.");
  }
  const rawTranslations = String(form.get("translations") || "");
  if (rawTranslations.length > 256 * 1024) {
    throw new CsvInputError("CSV_FILE_TOO_LARGE", "Translation preview payload is too large.");
  }
  let translations: unknown = null;
  if (rawTranslations) {
    try {
      translations = JSON.parse(rawTranslations);
    } catch {
      throw new CsvInputError("CSV_INVALID_JSON", "translations must be valid JSON.");
    }
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseAndNormalizeProductCsv(bytes, { importMode, inventoryMode });
  const rows = applyProductCsvTranslations(parsed.rows, translations);
  return {
    file,
    filename: "name" in file && typeof file.name === "string" ? file.name.slice(0, 255) : "products.csv",
    bytes,
    fileHash: sha256Hex(bytes),
    operationId,
    importMode,
    inventoryMode,
    parsed: { ...parsed, rows },
  };
}

export function publicImportRow(row: NormalizedProductImportRow) {
  return {
    rowNumber: row.rowNumber,
    sku: String(row.metadata.sku || ""),
    normalizedSku: row.normalizedSku,
    metadata: row.metadata,
    variants: row.variants,
  };
}

export async function processProductImportJob(
  supabase: SupabaseClient,
  jobId: string,
  actor: string,
  options: { retryFailed?: boolean; limit?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? CSV_IMPORT_PROCESS_CHUNK, 1), CSV_IMPORT_PROCESS_CHUNK);
  let query = (supabase as any)
    .from("product_import_rows")
    .select("row_number, status, retryable")
    .eq("job_id", jobId)
    .order("row_number")
    .limit(limit);
  query = options.retryFailed
    ? query.eq("status", "failed").eq("retryable", true)
    : query.eq("status", "pending");
  const { data: candidates, error: rowsError } = await query;
  if (rowsError) throw new Error("CSV_IMPORT_RPC_UNAVAILABLE");

  for (let index = 0; index < (candidates || []).length; index += 5) {
    const group = candidates.slice(index, index + 5);
    const applied = await Promise.all(group.map((row: { row_number: number }) => (
      (supabase as any).rpc("product_import_apply_row_rpc", {
        p_job_id: jobId,
        p_row_number: row.row_number,
        p_actor: actor,
        p_source: "admin_csv_import",
      })
    )));
    if (applied.some((result: { error?: unknown }) => result.error)) {
      throw new Error("CSV_IMPORT_RPC_UNAVAILABLE");
    }
  }

  const { data, error } = await (supabase as any).rpc("product_import_refresh_job_rpc", {
    p_job_id: jobId,
  });
  if (error) throw new Error("CSV_IMPORT_SUMMARY_UNAVAILABLE");
  return { job: data?.job || data, processed: (candidates || []).length };
}

export async function loadProductImportJob(
  supabase: SupabaseClient,
  options: { jobId?: string; operationId?: string; offset?: number; limit?: number; status?: string },
) {
  let jobQuery = (supabase as any).from("product_import_jobs").select("*");
  if (options.jobId) jobQuery = jobQuery.eq("id", options.jobId);
  else if (options.operationId) jobQuery = jobQuery.eq("client_request_id", options.operationId);
  else throw new Error("CSV_IMPORT_JOB_NOT_FOUND");
  const { data: job, error: jobError } = await jobQuery.maybeSingle();
  if (jobError) throw new Error("CSV_IMPORT_JOB_UNAVAILABLE");
  if (!job) return null;

  const offset = Math.max(options.offset ?? 0, 0);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  let rowsQuery = (supabase as any)
    .from("product_import_rows")
    .select("row_number, normalized_sku, status, attempt_count, retryable, product_id, error_code, error_summary, result_snapshot", { count: "exact" })
    .eq("job_id", job.id)
    .order("row_number")
    .range(offset, offset + limit - 1);
  if (options.status && ["pending", "processing", "succeeded", "failed"].includes(options.status)) {
    rowsQuery = rowsQuery.eq("status", options.status);
  }
  const { data: rows, count, error: rowsError } = await rowsQuery;
  if (rowsError) throw new Error("CSV_IMPORT_JOB_UNAVAILABLE");
  return { job, rows: rows || [], totalRows: count || 0, offset, limit };
}
