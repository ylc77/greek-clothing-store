import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/features";
import { getPublishedLegalSettings } from "@/lib/legal-settings";
import { OnlineOrderInputError, onlineOrderFingerprintPayload, parseOnlineOrderRequest } from "@/lib/online-order";
import { getTrustedClientIp, pseudonymizeSecuritySubject } from "@/lib/request-security";
import { getBusinessSettingsUncached } from "@/lib/settings";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { createVivaPaymentOrder, getVivaConfig, safeVivaError, vivaCheckoutUrl } from "@/lib/viva";

export const dynamic = "force-dynamic";

function safeDatabaseError(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || "");
  if (message.includes("ONLINE_ORDER_INSUFFICIENT_STOCK") || message.includes("ONLINE_ORDER_ITEM_UNAVAILABLE")) return { status: 409, code: "ITEM_UNAVAILABLE", error: "One or more selected items are no longer available." };
  if (message.includes("ONLINE_ORDER_BOXNOW_MINIMUM_NOT_MET")) return { status: 409, code: "BOXNOW_MINIMUM_NOT_MET", error: "The BOX NOW minimum merchandise amount has not been reached." };
  if (message.includes("ONLINE_ORDER_PICKUP_ONLY_ITEM")) return { status: 409, code: "PICKUP_ONLY_ITEM", error: "This cart contains an item available only for store pickup." };
  if (message.includes("ONLINE_ORDER_LOCKER_REQUIRED")) return { status: 400, code: "LOCKER_REQUIRED", error: "Choose a BOX NOW Locker." };
  if (message.includes("ONLINE_ORDER_PACKAGE_LIMIT")) return { status: 409, code: "PACKAGE_LIMIT", error: "This order exceeds the configured BOX NOW parcel limits." };
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
  if (!settings.viva_payments_enabled) return NextResponse.json({ error: "Online payment is not available.", code: "PAYMENT_DISABLED" }, { status: 503 });
  if (input.fulfillmentMethod === "box_now" && !settings.boxnow_enabled) return NextResponse.json({ error: "BOX NOW is not available.", code: "FULFILLMENT_DISABLED" }, { status: 409 });
  if (input.fulfillmentMethod === "store_pickup" && !settings.pickup_enabled) return NextResponse.json({ error: "Store pickup is not available.", code: "FULFILLMENT_DISABLED" }, { status: 409 });
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
  let vivaConfig;
  try { vivaConfig = getVivaConfig(); }
  catch { return NextResponse.json({ error: "Online payment is not configured.", code: "PAYMENT_UNAVAILABLE" }, { status: 503 }); }

  const { data, error } = await (supabase as any).rpc("online_checkout_prepare_rpc", {
    p_operation_id: input.operationId,
    p_request_fingerprint: fingerprint,
    p_access_token_hash: accessTokenHash,
    p_customer: input.customer,
    p_items: input.items,
    p_fulfillment_method: input.fulfillmentMethod,
    p_locker: input.locker,
    p_boxnow_enabled: settings.boxnow_enabled,
    p_pickup_enabled: settings.pickup_enabled,
    p_boxnow_minimum_subtotal: settings.boxnow_minimum_subtotal,
    p_boxnow_shipping_fee: settings.boxnow_shipping_fee,
    p_boxnow_free_shipping_threshold: settings.boxnow_free_shipping_threshold,
    p_boxnow_max_items: settings.boxnow_max_items,
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
  const orderId = String(data.id || "");
  const orderNumber = String(data.orderNumber || "");
  const amountCents = Number(data.amountCents);
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !orderNumber || !Number.isSafeInteger(amountCents) || amountCents < 1) {
    return NextResponse.json({ error: "Payment preparation needs reconciliation.", code: "PAYMENT_RECONCILIATION_REQUIRED" }, { status: 503 });
  }

  if (data.replayed === true) {
    const { data: existing } = await (supabase as any)
      .from("online_orders")
      .select("viva_order_code")
      .eq("id", orderId)
      .maybeSingle();
    const existingCode = String(existing?.viva_order_code || "");
    if (/^[0-9]{1,64}$/.test(existingCode)) {
      return NextResponse.json({
        ok: true,
        order: data,
        accessToken: input.accessToken,
        checkoutUrl: vivaCheckoutUrl(vivaConfig, existingCode),
        replayed: true,
      }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      error: "The earlier payment request has an unknown result and requires reconciliation before retrying.",
      code: "PAYMENT_RECONCILIATION_REQUIRED",
    }, { status: 503 });
  }

  let payment;
  try {
    payment = await createVivaPaymentOrder({
      amountCents,
      orderNumber,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerPhone: input.customer.phone,
      locale: input.locale,
    }, { config: vivaConfig });
  } catch (problem) {
    const safe = safeVivaError(problem);
    console.error("[online order] Viva payment order unavailable", { code: safe.code, retryable: safe.retryable, orderId });
    return NextResponse.json({
      error: safe.retryable
        ? "The payment request outcome is unknown. Do not retry with a new checkout session."
        : "The payment order could not be created.",
      code: safe.retryable ? "PAYMENT_RECONCILIATION_REQUIRED" : "PAYMENT_UNAVAILABLE",
    }, { status: 503 });
  }

  const { data: bound, error: bindError } = await (supabase as any).rpc("online_checkout_bind_viva_rpc", {
    p_operation_id: input.operationId,
    p_request_fingerprint: fingerprint,
    p_order_id: orderId,
    p_viva_order_code: payment.orderCode,
    p_payment_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (bindError || !bound) {
    console.error("[online order] Viva payment binding requires reconciliation", { orderId, code: String(bindError?.code || "") });
    return NextResponse.json({ error: "Payment was created but could not be attached to the order. Contact the store.", code: "PAYMENT_RECONCILIATION_REQUIRED" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    order: data,
    accessToken: input.accessToken,
    checkoutUrl: payment.checkoutUrl,
    replayed: false,
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
