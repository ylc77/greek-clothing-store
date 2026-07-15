import { NextRequest, NextResponse } from "next/server";
import {
  adminActorFromContext,
  adminHasPermission,
  getAdminAuthContextFromRequest,
} from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import {
  CSV_IMPORT_SCHEMA_VERSION,
  loadProductImportJob,
  prepareProductImportRows,
  processProductImportJob,
  productImportRuntimeReady,
  readProductCsvFormData,
  stablePayloadHash,
} from "@/lib/csv-import-server";
import { CsvInputError } from "@/lib/csv-parser";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const context = await getAdminAuthContextFromRequest(request);
  if (!context) {
    return { response: NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED", operationSafeToDiscard: true },
      { status: 401 },
    ) };
  }
  if (!adminHasPermission(context, "products:write")) {
    return { response: NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN", operationSafeToDiscard: true },
      { status: 403 },
    ) };
  }
  return { context };
}

function configurationUnavailable() {
  return NextResponse.json(
    {
      error: "Transactional CSV import is not configured.",
      code: "CSV_IMPORT_RPC_REQUIRED",
      operationSafeToDiscard: false,
    },
    { status: 503 },
  );
}

function inputError(error: CsvInputError) {
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
      rowNumber: error.rowNumber,
      field: error.field,
      operationSafeToDiscard: true,
    },
    { status: error.code === "CSV_FILE_TOO_LARGE" ? 413 : 400 },
  );
}

function startFailure(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message || "");
  if (message.includes("CSV_IMPORT_OPERATION_CONFLICT")) {
    return NextResponse.json(
      {
        error: "This operation ID is already attached to different CSV content.",
        code: "CSV_IMPORT_OPERATION_CONFLICT",
        operationSafeToDiscard: false,
      },
      { status: 409 },
    );
  }
  if (message.includes("CSV_IMPORT_INVALID_ARGUMENT")) {
    return NextResponse.json(
      { error: "Normalized CSV import data is invalid.", code: "CSV_IMPORT_INVALID_ARGUMENT", operationSafeToDiscard: true },
      { status: 400 },
    );
  }
  return configurationUnavailable();
}

export async function POST(request: NextRequest) {
  const authorized = await authorize(request);
  if (authorized.response) return authorized.response;
  if (!(await isFeatureEnabledUncached("csv_import"))) return featureDisabledResponse("csv_import");
  if (process.env.USE_PRODUCT_RPC !== "true" || process.env.USE_CSV_IMPORT_RPC !== "true") {
    return configurationUnavailable();
  }

  let form: Awaited<ReturnType<typeof readProductCsvFormData>>;
  try {
    form = await readProductCsvFormData(request, { requireOperationId: true });
  } catch (error) {
    if (error instanceof CsvInputError) return inputError(error);
    return NextResponse.json(
      { error: "CSV request could not be parsed.", code: "CSV_INVALID_REQUEST", operationSafeToDiscard: true },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase || !(await productImportRuntimeReady(supabase))) return configurationUnavailable();
  const actor = adminActorFromContext(authorized.context!);

  let preparedRows: Awaited<ReturnType<typeof prepareProductImportRows>>;
  try {
    preparedRows = await prepareProductImportRows(supabase as any, form.parsed.rows, {
      importMode: form.importMode,
      inventoryMode: form.inventoryMode,
    });
  } catch {
    return configurationUnavailable();
  }

  const payloadHash = stablePayloadHash({
    schemaVersion: CSV_IMPORT_SCHEMA_VERSION,
    fileHash: form.fileHash,
    importMode: form.importMode,
    inventoryMode: form.inventoryMode,
    rows: preparedRows,
  });

  const { data: startData, error: startError } = await (supabase as any).rpc(
    "product_import_start_rpc",
    {
      p_client_request_id: form.operationId,
      p_payload_hash: payloadHash,
      p_filename: form.filename,
      p_import_mode: form.importMode,
      p_inventory_mode: form.inventoryMode,
      p_rows: preparedRows,
      p_actor: actor,
      p_source: "admin_csv_import",
    },
  );
  if (startError) return startFailure(startError);
  const job = startData?.job || startData;
  const jobId = typeof job?.id === "string" ? job.id : "";
  if (!jobId) {
    return NextResponse.json(
      {
        error: "The import job may have been created but returned an unreadable result. Recover it with the same operation ID.",
        code: "CSV_IMPORT_RESULT_UNKNOWN",
        operationSafeToDiscard: false,
      },
      { status: 503 },
    );
  }

  try {
    const processed = await processProductImportJob(supabase as any, jobId, actor);
    if (processed.processed > 0) {
      try { invalidateProductsCache(); } catch { /* A durable Job remains authoritative. */ }
    }
    const view = await loadProductImportJob(supabase as any, { jobId, limit: 50 });
    return NextResponse.json(
      { ...view, fileHash: form.fileHash, payloadHash, replayed: startData?.replayed === true },
      { status: processed.job?.pending_rows > 0 ? 202 : 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error: "The import job exists, but processing status must be recovered before retrying.",
        code: "CSV_IMPORT_PROCESSING_UNAVAILABLE",
        jobId,
        operationSafeToDiscard: false,
      },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest) {
  const authorized = await authorize(request);
  if (authorized.response) return authorized.response;
  if (!(await isFeatureEnabledUncached("csv_import"))) return featureDisabledResponse("csv_import");
  const operationId = new URL(request.url).searchParams.get("operationId")?.trim() || "";
  if (!operationId) {
    return NextResponse.json(
      { error: "operationId is required.", code: "INVALID_ARGUMENT", operationSafeToDiscard: true },
      { status: 400 },
    );
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) return configurationUnavailable();
  try {
    const view = await loadProductImportJob(supabase as any, { operationId, limit: 50 });
    if (!view) {
      return NextResponse.json(
        { error: "Import job not found.", code: "CSV_IMPORT_JOB_NOT_FOUND", operationSafeToDiscard: true },
        { status: 404 },
      );
    }
    return NextResponse.json(view);
  } catch {
    return configurationUnavailable();
  }
}
