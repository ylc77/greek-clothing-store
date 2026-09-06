import { NextRequest } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminPrivateJson } from "@/lib/admin-response";
import { invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

function optionalPositive(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : undefined;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAdminRequest(request, "products:write");
  if (!authorization.allowed) return adminPrivateJson({ error: authorization.error, code: authorization.code }, { status: authorization.status });
  if (!(await isFeatureEnabledUncached("product_management"))) return featureDisabledResponse("product_management");
  const productId = Number((await params).id);
  if (!Number.isSafeInteger(productId) || productId < 1) return adminPrivateJson({ error: "商品编号无效。" }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return adminPrivateJson({ error: "请求格式无效。" }, { status: 400 }); }
  const operationId = String(body.operationId || "");
  const profile = String(body.fulfillmentProfile || "");
  if (!/^[0-9a-f-]{36}$/i.test(operationId) || !["boxnow_and_pickup", "pickup_only"].includes(profile)) return adminPrivateJson({ error: "配送资料无效。" }, { status: 400 });
  const dimensions = [body.packageWeightGrams, body.packageLengthMm, body.packageWidthMm, body.packageHeightMm].map(optionalPositive);
  if (dimensions.some(value => value === undefined)) return adminPrivateJson({ error: "包装重量和尺寸必须为正整数。" }, { status: 400 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return adminPrivateJson({ error: "商品数据库未配置。" }, { status: 503 });
  const { data, error } = await (supabase as any).rpc("product_fulfillment_update_rpc", {
    p_product_id: productId, p_operation_id: operationId, p_fulfillment_profile: profile,
    p_shipping_note_en: String(body.shippingNoteEn || "").trim().slice(0, 500),
    p_shipping_note_gr: String(body.shippingNoteGr || "").trim().slice(0, 500),
    p_shipping_note_zh: String(body.shippingNoteZh || "").trim().slice(0, 500),
    p_package_weight_grams: dimensions[0], p_package_length_mm: dimensions[1],
    p_package_width_mm: dimensions[2], p_package_height_mm: dimensions[3],
    p_actor: adminActorFromContext(authorization.context),
  });
  if (error || !data) return adminPrivateJson({ error: "商品配送资料保存失败。", code: "PRODUCT_FULFILLMENT_UNAVAILABLE" }, { status: 503 });
  await invalidateProductsCache(String(data.sku || ""));
  return adminPrivateJson({ ok: true, product: data });
}
