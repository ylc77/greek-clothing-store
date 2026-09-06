import { NextRequest, NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/features";
import {
  calculateFulfillmentOptions,
  centsToEuros,
  eurosToCents,
  FulfillmentInputError,
  fulfillmentItemKey,
  parseFulfillmentQuoteRequest,
  type FulfillmentProfile,
} from "@/lib/fulfillment";
import { getBusinessSettingsUncached } from "@/lib/settings";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PublicVariant = {
  size?: unknown;
  color?: unknown;
  price?: unknown;
  quantity_available?: unknown;
  fulfillment_profile?: unknown;
  package_weight_grams?: unknown;
  package_length_mm?: unknown;
  package_width_mm?: unknown;
  package_height_mm?: unknown;
};

function profile(value: unknown): FulfillmentProfile {
  return value === "pickup_only" ? "pickup_only" : "boxnow_and_pickup";
}

function packageMeasurement(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest) {
  if (!(await isFeatureEnabled("online_orders"))) {
    return NextResponse.json({ error: "Online ordering is disabled.", code: "FEATURE_DISABLED" }, { status: 403 });
  }
  let requested;
  try {
    requested = parseFulfillmentQuoteRequest(await request.text());
  } catch (error) {
    const problem = error instanceof FulfillmentInputError
      ? error
      : new FulfillmentInputError("INVALID_REQUEST", "Quote request is invalid.");
    return NextResponse.json({ error: problem.message, code: problem.code }, { status: problem.code === "PAYLOAD_TOO_LARGE" ? 413 : 400 });
  }

  const [settings, supabase] = await Promise.all([getBusinessSettingsUncached(), Promise.resolve(getSupabaseAdminClient())]);
  if (!settings.online_store_enabled) {
    return NextResponse.json({ error: "Online ordering is not open yet.", code: "ONLINE_STORE_CLOSED" }, { status: 503 });
  }
  if (!supabase) {
    return NextResponse.json({ error: "Checkout pricing is temporarily unavailable.", code: "QUOTE_UNAVAILABLE" }, { status: 503 });
  }

  const uniqueSkus = Array.from(new Set(requested.map(item => item.productSku.toLocaleLowerCase())));
  const variantsByKey = new Map<string, PublicVariant>();
  for (let offset = 0; offset < uniqueSkus.length; offset += 20) {
    const { data, error } = await (supabase as any).rpc("product_checkout_variants_batch_rpc", {
      p_product_skus: uniqueSkus.slice(offset, offset + 20),
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ error: "Checkout pricing is temporarily unavailable.", code: "QUOTE_UNAVAILABLE" }, { status: 503 });
    }
    for (const [sku, variants] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(variants)) continue;
      for (const variant of variants as PublicVariant[]) {
        variantsByKey.set(fulfillmentItemKey({
          productSku: sku,
          size: String(variant.size || "ONE SIZE"),
          color: String(variant.color || ""),
        }), variant);
      }
    }
  }

  const items = [] as Array<(typeof requested)[number] & {
    availableQuantity: number;
    unitPriceCents: number;
    fulfillmentProfile: FulfillmentProfile;
    packageWeightGrams: number | null;
    packageLengthMm: number | null;
    packageWidthMm: number | null;
    packageHeightMm: number | null;
  }>;
  for (const item of requested) {
    const variant = variantsByKey.get(fulfillmentItemKey(item));
    const unitPrice = Number(variant?.price);
    const availableQuantity = Math.max(0, Math.trunc(Number(variant?.quantity_available) || 0));
    if (!variant || !Number.isFinite(unitPrice) || unitPrice < 0 || availableQuantity < item.quantity) {
      return NextResponse.json({ error: "One or more selected items are no longer available.", code: "ITEM_UNAVAILABLE" }, { status: 409 });
    }
    items.push({
      ...item,
      availableQuantity,
      unitPriceCents: eurosToCents(unitPrice),
      fulfillmentProfile: profile(variant.fulfillment_profile),
      packageWeightGrams: packageMeasurement(variant.package_weight_grams),
      packageLengthMm: packageMeasurement(variant.package_length_mm),
      packageWidthMm: packageMeasurement(variant.package_width_mm),
      packageHeightMm: packageMeasurement(variant.package_height_mm),
    });
  }

  const quote = calculateFulfillmentOptions(items, {
    boxNowEnabled: settings.viva_payments_enabled && settings.boxnow_enabled,
    storePickupEnabled: settings.viva_payments_enabled && settings.pickup_enabled,
    boxNowMinimumSubtotalCents: eurosToCents(settings.boxnow_minimum_subtotal),
    boxNowShippingFeeCents: eurosToCents(settings.boxnow_shipping_fee),
    boxNowFreeShippingThresholdCents: settings.boxnow_free_shipping_threshold == null
      ? null
      : eurosToCents(settings.boxnow_free_shipping_threshold),
    boxNowMaxWeightGrams: settings.boxnow_max_weight_grams,
    boxNowMaxLengthMm: settings.boxnow_max_length_mm,
    boxNowMaxWidthMm: settings.boxnow_max_width_mm,
    boxNowMaxHeightMm: settings.boxnow_max_height_mm,
  });

  return NextResponse.json({
    ok: true,
    currency: "EUR",
    merchandiseSubtotalCents: quote.merchandiseSubtotalCents,
    merchandiseSubtotal: centsToEuros(quote.merchandiseSubtotalCents),
    containsPickupOnly: quote.containsPickupOnly,
    boxNow: { ...quote.boxNow, fee: centsToEuros(quote.boxNow.feeCents), amountMissing: centsToEuros(quote.boxNow.amountMissingCents) },
    storePickup: { ...quote.storePickup, fee: 0 },
    items: items.map(item => ({
      productSku: item.productSku,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      availableQuantity: item.availableQuantity,
      unitPriceCents: item.unitPriceCents,
      fulfillmentProfile: item.fulfillmentProfile,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
