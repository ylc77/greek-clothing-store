import { NextRequest, NextResponse } from "next/server";
import {
  CartAvailabilityInputError,
  cartAvailabilityKey,
  parseCartAvailabilityRequest,
  type CartAvailabilityItem,
} from "@/lib/cart-availability";
import { isFeatureEnabled } from "@/lib/features";
import { publicVariantOptions } from "@/lib/product-variant-matrix";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isFeatureEnabled("online_orders"))) {
    return NextResponse.json({ error: "Online ordering is disabled.", code: "FEATURE_DISABLED" }, { status: 403 });
  }

  let items;
  try {
    items = parseCartAvailabilityRequest(await request.text());
  } catch (error) {
    const problem = error instanceof CartAvailabilityInputError
      ? error
      : new CartAvailabilityInputError("INVALID_REQUEST", "Availability request is invalid.");
    return NextResponse.json(
      { error: problem.message, code: problem.code },
      { status: problem.code === "PAYLOAD_TOO_LARGE" ? 413 : 400 },
    );
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Inventory availability is temporarily unavailable.", code: "AVAILABILITY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const uniqueSkus = Array.from(new Set(items.map(item => item.productSku.toLocaleLowerCase())));
  const variantsBySku = new Map<string, ReturnType<typeof publicVariantOptions>>();
  for (let offset = 0; offset < uniqueSkus.length; offset += 20) {
    const requestedSkus = uniqueSkus.slice(offset, offset + 20);
    const { data, error } = await (supabase as any).rpc("product_public_variants_batch_rpc", {
      p_product_skus: requestedSkus,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json(
        { error: "Inventory availability is temporarily unavailable.", code: "AVAILABILITY_UNAVAILABLE" },
        { status: 503 },
      );
    }
    for (const [sku, variants] of Object.entries(data as Record<string, unknown>)) {
      variantsBySku.set(sku.trim().toLocaleLowerCase(), publicVariantOptions(variants));
    }
  }

  const responseItems: CartAvailabilityItem[] = items.map(item => {
    const variants = variantsBySku.get(item.productSku.toLocaleLowerCase()) || [];
    const selected = variants.find(variant => cartAvailabilityKey({
      productSku: item.productSku,
      size: variant.size,
      color: variant.color,
    }) === cartAvailabilityKey(item));
    return {
      ...item,
      availableQuantity: selected?.quantityAvailable || 0,
      unitPrice: selected?.unitPrice ?? null,
    };
  });

  return NextResponse.json(
    { ok: true, items: responseItems },
    { headers: { "Cache-Control": "no-store" } },
  );
}
