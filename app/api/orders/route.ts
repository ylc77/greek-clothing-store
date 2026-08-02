import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/features";
import { getPublishedLegalSettings } from "@/lib/legal-settings";
import { OnlineOrderInputError, onlineOrderFingerprintPayload, parseOnlineOrderRequest } from "@/lib/online-order";
import { getTrustedClientIp, pseudonymizeSecuritySubject } from "@/lib/request-security";
import { getBusinessSettingsUncached } from "@/lib/settings";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function safeDatabaseError(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || "");
  if (message.includes("ONLINE_ORDER_INSUFFICIENT_STOCK") || message.includes("ONLINE_ORDER_ITEM_UNAVAILABLE")) return { status: 409, code: "ITEM_UNAVAILABLE", error: "One or more selected items are no longer available." };
  if (message.includes("ONLINE_ORDER_IDEMPOTENCY_CONFLICT")) return { status: 409, code: "OPERATION_CONFLICT", error: "This checkout operation does not match the original request." };
  if (message.includes("ONLINE_ORDER_")) return { status: 400, code: "ORDER_REJECTED", error: "The order could not be accepted." };
  return { status: 503, code: "ONLINE_ORDER_UNAVAILABLE", error: "Online ordering is temporarily unavailable." };
}

export async function POST(request: NextRequest) {
  if (!(await isFeatureEnabled("online_orders"))) return NextResponse.json({ error: "Online ordering is disabled.", code: "FEATURE_DISABLED" }, { status: 403 });
  let input;
  try { input = parseOnlineOrderRequest(await request.text()); }
  catch (error) {
    const problem = error instanceof OnlineOrderInputError ? error : new OnlineOrderInputError("INVALID_ORDER", "Order request is invalid.");
    return NextResponse.json({ error: problem.message, code: problem.code }, { status: problem.code === "PAYLOAD_TOO_LARGE" ? 413 : 400 });
  }

  const [settings, legal] = await Promise.all([getBusinessSettingsUncached(), getPublishedLegalSettings()]);
  if (!settings.online_store_enabled) return NextResponse.json({ error: "Online ordering is not open yet.", code: "ONLINE_STORE_CLOSED" }, { status: 503 });
  if (input.fulfillmentMethod === "delivery" && !settings.delivery_enabled) return NextResponse.json({ error: "Delivery is not available.", code: "FULFILLMENT_DISABLED" }, { status: 409 });
  if (input.fulfillmentMethod === "pickup" && !settings.pickup_enabled) return NextResponse.json({ error: "Store pickup is not available.", code: "FULFILLMENT_DISABLED" }, { status: 409 });
  if (!legal.complete || !legal.currentVersion) return NextResponse.json({ error: "The store legal information is not ready for online ordering.", code: "LEGAL_CONFIGURATION_INCOMPLETE" }, { status: 503 });

  const supabase = getSupabaseAdminClient();
  const secret = String(process.env.AUTH_RATE_LIMIT_SECRET || "");
  if (!supabase || secret.length < 32 || process.env.USE_ONLINE_ORDER_RPC !== "true") return NextResponse.json({ error: "Online order security is not configured.", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });

  let subjectHash: string;
  try { subjectHash = pseudonymizeSecuritySubject("online-order", getTrustedClientIp(request.headers), secret); }
  catch { return NextResponse.json({ error: "Online order security is unavailable.", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 }); }
  const { data: limit, error: limitError } = await (supabase as any).rpc("online_order_rate_limit_rpc", { p_subject_hash: subjectHash, p_limit: 10, p_window_seconds: 900 });
  if (limitError || !limit || typeof limit !== "object") return NextResponse.json({ error: "Online order security is unavailable.", code: "ONLINE_ORDER_UNAVAILABLE" }, { status: 503 });
  if (limit.allowed !== true) return NextResponse.json({ error: "Too many order attempts. Try again later.", code: "ORDER_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.max(1, Number(limit.retryAfter) || 1)) } });

  const fingerprint = createHash("sha256").update(onlineOrderFingerprintPayload(input)).digest("hex");
  const accessTokenHash = createHash("sha256").update(input.accessToken).digest("hex");
  const { data, error } = await (supabase as any).rpc("online_order_create_rpc", {
    p_operation_id: input.operationId,
    p_request_fingerprint: fingerprint,
    p_access_token_hash: accessTokenHash,
    p_customer: input.customer,
    p_items: input.items,
    p_fulfillment_method: input.fulfillmentMethod,
    p_payment_method: input.fulfillmentMethod === "delivery" ? "cash_on_delivery" : "pay_at_pickup",
    p_shipping_fee: settings.shipping_fee,
    p_free_shipping_threshold: settings.free_shipping_threshold,
    p_locale: input.locale,
    p_legal_terms_version: legal.currentVersion,
    p_privacy_policy_version: legal.currentVersion,
    p_legal_accepted_at: new Date().toISOString(),
  });
  if (error || !data) {
    const safe = safeDatabaseError(error);
    if (safe.status === 503) console.error("[online order] transaction unavailable", { code: String(error?.code || ""), message: String(error?.message || "") });
    return NextResponse.json({ error: safe.error, code: safe.code }, { status: safe.status });
  }
  return NextResponse.json({ ok: true, order: data, accessToken: input.accessToken }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
