import { NextRequest } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure, adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const decision = await authorizeAdminRequest(request, "inventory:read");
  if (!decision.allowed) return adminAuthorizationFailure(decision);
  if (!(await isFeatureEnabled("inventory"))) return applyAdminPrivateCache(featureDisabledResponse("inventory"));
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return adminPrivateJson({ error: "Invalid receipt ID.", code: "INVALID_ARGUMENT" }, { status: 400 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return adminPrivateJson({ error: "Receipt data is unavailable.", code: "INVENTORY_RECEIPT_DATA_UNAVAILABLE" }, { status: 503 });
  const [receiptResult, itemResult] = await Promise.all([
    (supabase as any).from("inventory_receipts")
      .select("id,receipt_number,supplier_id,supplier_reference,status,received_at,notes,total_units,created_by,completed_at,suppliers(name)")
      .eq("id", id).maybeSingle(),
    (supabase as any).from("inventory_receipt_items")
      .select("id,variant_id,quantity_received,unit_cost,product_name_snapshot,product_sku_snapshot,variant_sku_snapshot,barcode_snapshot,price_snapshot,size_snapshot,color_snapshot,quantity_before,quantity_after,movement_id,created_at")
      .eq("receipt_id", id).order("created_at", { ascending: true }),
  ]);
  if (receiptResult.error || itemResult.error) return adminPrivateJson({ error: "Receipt data is unavailable.", code: "INVENTORY_RECEIPT_DATA_UNAVAILABLE" }, { status: 503 });
  if (!receiptResult.data) return adminPrivateJson({ error: "Receipt not found.", code: "NOT_FOUND" }, { status: 404 });
  return adminPrivateJson({ receipt: receiptResult.data, items: itemResult.data || [] });
}
