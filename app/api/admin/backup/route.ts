import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import {
  buildProductCsvExport,
  createCsvDownloadHeaders,
} from "@/lib/csv-output";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const decision = await authorizeAdminRequest(request, "backup:read");
  return decision.allowed ? null : adminAuthorizationFailure(decision);
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  if (!(await isFeatureEnabled("backup_tools"))) {
    return featureDisabledResponse("backup_tools");
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Product export is unavailable.", code: "CSV_EXPORT_UNAVAILABLE" },
      { status: 503 },
    );
  }

  try {
    const result = await buildProductCsvExport({
      pageSize: 500,
      fetchProductsPage: async (from, to) => {
        const { data, count, error } = await supabase
          .from("products")
          .select("*", { count: "exact" })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        return { data, count, error };
      },
      fetchVariantsPage: async (from, to) => {
        const { data, count, error } = await supabase
          .from("product_variants")
          .select(
            "id, product_id, size, color, supplier_sku, cost_price, reorder_level",
            { count: "exact" },
          )
          .order("product_id")
          .order("sort_order")
          .order("id")
          .range(from, to);
        return { data, count, error };
      },
    });

    const headers = createCsvDownloadHeaders(result.filename);
    headers.set("X-Export-Purpose", "maintenance-csv");
    headers.set("X-Disaster-Recovery", "false");
    return new Response(result.csv, { headers });
  } catch (error) {
    console.error("[product-export] complete paged export failed", {
      code: String((error as { code?: unknown } | null)?.code || "CSV_EXPORT_FAILED"),
    });
    return NextResponse.json(
      {
        error: "Product export could not be completed. No partial CSV was generated.",
        code: "CSV_EXPORT_FAILED",
      },
      { status: 503 },
    );
  }
}
