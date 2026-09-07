import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getVivaConfig, getVivaWebhookVerificationKey, retrieveVivaTransaction, safeVivaError } from "@/lib/viva";
import { parseVivaWebhook, VivaWebhookInputError } from "@/lib/viva-webhook";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { Key: getVivaWebhookVerificationKey() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Webhook verification is not configured." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let event;
  try { event = parseVivaWebhook(await request.text()); }
  catch (error) {
    const problem = error instanceof VivaWebhookInputError ? error : new VivaWebhookInputError("INVALID_EVENT", "Webhook event is invalid.");
    return NextResponse.json({ error: problem.message }, { status: problem.code === "PAYLOAD_TOO_LARGE" ? 413 : 400 });
  }
  const supabase = getSupabaseAdminClient();
  let config;
  try { config = getVivaConfig(); }
  catch { return NextResponse.json({ error: "Webhook processing is unavailable." }, { status: 503 }); }
  if (!supabase) return NextResponse.json({ error: "Webhook processing is unavailable." }, { status: 503 });

  if (event.sourceCode !== config.sourceCode || event.merchantId !== config.merchantId) {
    return NextResponse.json({ error: "Webhook merchant or source does not match this store." }, { status: 400 });
  }

  if (event.eventTypeId !== 1796) {
    if (event.eventTypeId === 1797) {
      const { data, error } = await (supabase as any).rpc("online_payment_confirm_rpc", {
        p_provider_event_id: event.eventId,
        p_event_type: event.eventType,
        p_provider_order_code: event.orderCode,
        p_provider_transaction_id: event.transactionId,
        p_amount_cents: event.amountCents,
        p_currency: event.currency,
        p_payload_digest: event.payloadDigest,
        p_confirmed_success: false,
      });
      if (error || !data) return NextResponse.json({ error: "Reversal reconciliation could not be recorded." }, { status: 503 });
      return NextResponse.json({ ok: true, reconciliationRequired: true });
    }
    const { error } = await (supabase as any).from("online_payment_events").upsert({
      provider: "viva",
      provider_event_id: event.eventId,
      event_type: event.eventType,
      provider_order_code: event.orderCode,
      provider_transaction_id: event.transactionId,
      amount_cents: event.amountCents,
      currency: event.currency,
      status: "ignored",
      payload_digest: event.payloadDigest,
      failure_code: "PAYMENT_FAILED_MAY_RETRY",
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: "Webhook event could not be recorded." }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  let verified;
  try { verified = await retrieveVivaTransaction(event.transactionId, { config }); }
  catch (error) {
    const safe = safeVivaError(error);
    console.error("[viva webhook] transaction verification unavailable", { code: safe.code, retryable: safe.retryable, eventId: event.eventId });
    return NextResponse.json({ error: "Transaction verification is unavailable." }, { status: 503 });
  }
  const confirmed = verified.orderCode === event.orderCode
    && verified.statusId === "F"
    && verified.amountCents === event.amountCents
    && verified.currency === "EUR"
    && verified.sourceCode === config.sourceCode;
  const { data, error } = await (supabase as any).rpc("online_payment_confirm_rpc", {
    p_provider_event_id: event.eventId,
    p_event_type: event.eventType,
    p_provider_order_code: event.orderCode,
    p_provider_transaction_id: event.transactionId,
    p_amount_cents: verified.amountCents,
    p_currency: verified.currency,
    p_payload_digest: event.payloadDigest,
    p_confirmed_success: confirmed,
  });
  if (error || !data) {
    console.error("[viva webhook] database confirmation unavailable", { eventId: event.eventId, code: String(error?.code || "") });
    return NextResponse.json({ error: "Payment confirmation is unavailable." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, reconciliationRequired: data.reconciliationRequired === true });
}
