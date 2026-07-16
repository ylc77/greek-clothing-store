import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { createCsvDownloadHeaders, serializeCsv } from "@/lib/csv-output";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await authorizeAdminRequest(request, "products:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabledUncached("csv_import"))) return featureDisabledResponse("csv_import");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "CSV import is unavailable.", code: "CSV_IMPORT_RPC_UNAVAILABLE" }, { status: 503 });
  const { id } = await context.params;
  const { data, error } = await (supabase as any)
    .from("product_import_rows")
    .select("row_number, normalized_sku, error_code, error_summary, retryable")
    .eq("job_id", id)
    .eq("status", "failed")
    .order("row_number")
    .range(0, 499);
  if (error) return NextResponse.json({ error: "Failed rows are unavailable.", code: "CSV_IMPORT_JOB_UNAVAILABLE" }, { status: 503 });
  const csv = serializeCsv(
    ["row_number", "sku", "error_code", "error_summary", "retryable"],
    (data || []).map((row: Record<string, unknown>) => [
      Number(row.row_number),
      String(row.normalized_sku || ""),
      String(row.error_code || ""),
      String(row.error_summary || ""),
      row.retryable === true,
    ]),
  );
  return new Response(`\uFEFF${csv}`, {
    headers: createCsvDownloadHeaders(`product-import-${id}-failed.csv`),
  });
}
