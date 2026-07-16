import { NextRequest, NextResponse } from "next/server";
import {
  adminHasPermission,
  getAdminAuthContextFromRequest,
} from "@/lib/admin-auth";
import {
  buildProductCsvExport,
  createCsvDownloadHeaders,
} from "@/lib/csv-output";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const context = await getAdminAuthContextFromRequest(request);
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  if (!adminHasPermission(context, "backup:read")) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  return null;
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

    return new Response(result.csv, {
      headers: createCsvDownloadHeaders(result.filename),
    });
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
