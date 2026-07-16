import { NextRequest, NextResponse } from "next/server";
import {
  adminActorFromContext,
  adminHasPermission,
  getAdminAuthContextFromRequest,
} from "@/lib/admin-auth";
import { invalidateProductsCache } from "@/lib/cache";
import {
  loadProductImportJob,
  processProductImportJob,
  productImportRuntimeReady,
} from "@/lib/csv-import-server";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await getAdminAuthContextFromRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  if (!adminHasPermission(auth, "products:write")) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  if (!(await isFeatureEnabledUncached("csv_import"))) return featureDisabledResponse("csv_import");
  if (process.env.USE_PRODUCT_RPC !== "true" || process.env.USE_CSV_IMPORT_RPC !== "true") {
    return NextResponse.json({ error: "Transactional CSV import is not configured.", code: "CSV_IMPORT_RPC_REQUIRED" }, { status: 503 });
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase || !(await productImportRuntimeReady(supabase))) {
    return NextResponse.json({ error: "CSV import is unavailable.", code: "CSV_IMPORT_RPC_UNAVAILABLE" }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    const processed = await processProductImportJob(supabase as any, id, adminActorFromContext(auth), { retryFailed: true });
    if (processed.processed > 0) {
      try { invalidateProductsCache(); } catch { /* Job state remains authoritative. */ }
    }
    const view = await loadProductImportJob(supabase as any, { jobId: id, limit: 50 });
    if (!view) return NextResponse.json({ error: "Import job not found.", code: "CSV_IMPORT_JOB_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ...view, processed: processed.processed });
  } catch {
    return NextResponse.json({ error: "Failed rows could not be retried safely.", code: "CSV_IMPORT_RETRY_UNAVAILABLE" }, { status: 503 });
  }
}
