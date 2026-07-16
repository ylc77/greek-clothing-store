import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { productErrorResponse } from "@/lib/product-transactions";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "products:read");
  if (!authorization.allowed) {
    return productErrorResponse(authorization.error, authorization.status, authorization.code, true);
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  if (process.env.USE_PRODUCT_RPC !== "true") {
    return productErrorResponse(
      "Transactional product RPC is required before reconciliation can run.",
      503,
      "PRODUCT_RPC_REQUIRED",
      false,
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return productErrorResponse("Admin Supabase is not configured.", 503, "PRODUCT_RPC_UNAVAILABLE", false);
  }

  const { data, error } = await (supabase as any).rpc("product_reconciliation_rpc");
  if (error) {
    console.error("[product reconciliation] RPC failed", {
      message: String(error.message || ""),
      code: String(error.code || ""),
    });
    return productErrorResponse(
      "Product reconciliation is temporarily unavailable.",
      503,
      "PRODUCT_RPC_UNAVAILABLE",
      false,
    );
  }
  return NextResponse.json(data);
}
