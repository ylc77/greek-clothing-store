import { NextRequest, NextResponse } from "next/server";
import { adminHasPermission, getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { productErrorResponse } from "@/lib/product-transactions";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function blocked(error: string, code: string, details?: unknown) {
  return NextResponse.json(
    {
      ready: false,
      error,
      code,
      operationSafeToDiscard: false,
      requiresConfiguration: true,
      details: details || undefined,
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest) {
  const authContext = await getAdminAuthContextFromRequest(request);
  if (!authContext) return productErrorResponse("Unauthorized", 401, "UNAUTHORIZED", true);
  if (!adminHasPermission(authContext, "products:read")) {
    return productErrorResponse("Forbidden", 403, "FORBIDDEN", true);
  }
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");

  if (process.env.USE_PRODUCT_RPC !== "true") {
    return blocked(
      "Product management requires the transactional product RPC configuration.",
      "PRODUCT_RPC_REQUIRED",
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return blocked("Admin Supabase is not configured.", "PRODUCT_RPC_UNAVAILABLE");

  const { data, error } = await (supabase as any).rpc("product_runtime_health_rpc");
  if (error) {
    console.error("[product health] runtime RPC check failed", {
      message: String(error.message || ""),
      code: String(error.code || ""),
    });
    return blocked("Transactional product RPC is missing, not executable, or unavailable.", "PRODUCT_RPC_UNAVAILABLE");
  }
  if (data?.ready !== true) {
    return blocked("Transactional product RPC is not fully installed.", "PRODUCT_RPC_UNAVAILABLE", data);
  }
  return NextResponse.json({ ready: true, version: data.version, details: data });
}
