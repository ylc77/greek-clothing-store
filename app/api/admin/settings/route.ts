import { NextRequest, NextResponse } from "next/server";
import { invalidateSettingsCache } from "@/lib/cache";
import { developerRequestIsAuthorized } from "@/lib/developer-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getBusinessSettings, getBusinessSettingsUncached } from "@/lib/settings";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!(await developerRequestIsAuthorized(request))) {
    return unauthorized();
  }

  const settings = await getBusinessSettingsUncached();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  if (!(await developerRequestIsAuthorized(request))) {
    return unauthorized();
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Admin Supabase is not configured." },
      { status: 500 },
    );
  }

  const payload = (await request.json()) as Record<string, unknown>;
  const stringOrNull = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  // Build update object only with provided fields
  const update: Record<string, unknown> = {};
  const fields = [
    "business_name",
    "logo_url",
    "hero_image_url",
    "description_cn",
    "description_en",
    "description_gr",
    "phone",
    "whatsapp",
    "instagram",
    "facebook",
    "tiktok",
    "address",
    "google_maps_url",
    "opening_hours",
    "footer_text",
    "pickup_instructions_en",
    "pickup_instructions_gr",
    "delivery_instructions_en",
    "delivery_instructions_gr",
    "order_notification_email",
  ];
  for (const f of fields) {
    if (f in payload) update[f] = stringOrNull(payload[f]);
  }
  for (const field of ["online_store_enabled", "delivery_enabled", "pickup_enabled", "viva_payments_enabled", "boxnow_enabled"] as const) {
    if (field in payload) update[field] = payload[field] === true;
  }
  for (const field of ["boxnow_minimum_subtotal", "boxnow_shipping_fee"] as const) {
    if (!(field in payload)) continue;
    const value = Number(payload[field]);
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      return NextResponse.json({ error: `${field} 配置无效。` }, { status: 400 });
    }
    update[field] = Math.round(value * 100) / 100;
  }
  if ("boxnow_free_shipping_threshold" in payload) {
    if (payload.boxnow_free_shipping_threshold === null || payload.boxnow_free_shipping_threshold === "") {
      update.boxnow_free_shipping_threshold = null;
    } else {
      const value = Number(payload.boxnow_free_shipping_threshold);
      if (!Number.isFinite(value) || value < 0 || value > 100000) {
        return NextResponse.json({ error: "BOX NOW 包邮门槛无效。" }, { status: 400 });
      }
      update.boxnow_free_shipping_threshold = Math.round(value * 100) / 100;
    }
  }
  const integerRanges = {
    boxnow_max_items: [1, 100],
    boxnow_max_weight_grams: [1, 100000],
    boxnow_max_length_mm: [1, 2000],
    boxnow_max_width_mm: [1, 2000],
    boxnow_max_height_mm: [1, 2000],
    pickup_hold_days: [1, 30],
  } as const;
  for (const [field, [minimum, maximum]] of Object.entries(integerRanges)) {
    if (!(field in payload)) continue;
    const value = Number(payload[field]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return NextResponse.json({ error: `${field} 配置无效。` }, { status: 400 });
    }
    update[field] = value;
  }
  if ("shipping_fee" in payload) {
    const value = Number(payload.shipping_fee);
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      return NextResponse.json({ error: "配送费用无效。" }, { status: 400 });
    }
    update.shipping_fee = Math.round(value * 100) / 100;
  }
  if ("free_shipping_threshold" in payload) {
    if (payload.free_shipping_threshold === null || payload.free_shipping_threshold === "") {
      update.free_shipping_threshold = null;
    } else {
      const value = Number(payload.free_shipping_threshold);
      if (!Number.isFinite(value) || value < 0 || value > 100000) {
        return NextResponse.json({ error: "免配送费门槛无效。" }, { status: 400 });
      }
      update.free_shipping_threshold = Math.round(value * 100) / 100;
    }
  }

  // Get the existing row id
  const existing = await getBusinessSettingsUncached();
  const minimum = Number(update.boxnow_minimum_subtotal ?? existing.boxnow_minimum_subtotal);
  const freeThreshold = update.boxnow_free_shipping_threshold === null
    ? null
    : Number(update.boxnow_free_shipping_threshold ?? existing.boxnow_free_shipping_threshold);
  if (freeThreshold !== null && freeThreshold < minimum) {
    return NextResponse.json({ error: "BOX NOW 包邮门槛不能低于起送金额。" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("business_settings")
    .upsert({ id: existing.id, ...update }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSettingsCache();
  const settings = await getBusinessSettingsUncached();
  return NextResponse.json(settings);
}
