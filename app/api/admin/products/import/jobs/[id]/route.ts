import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { loadProductImportJob } from "@/lib/csv-import-server";
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
  const url = new URL(request.url);
  try {
    const view = await loadProductImportJob(supabase as any, {
      jobId: id,
      offset: Number(url.searchParams.get("offset")) || 0,
      limit: Number(url.searchParams.get("limit")) || 50,
      status: url.searchParams.get("status") || undefined,
    });
    if (!view) return NextResponse.json({ error: "Import job not found.", code: "CSV_IMPORT_JOB_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(view);
  } catch {
    return NextResponse.json({ error: "Import job is temporarily unavailable.", code: "CSV_IMPORT_JOB_UNAVAILABLE" }, { status: 503 });
  }
}
