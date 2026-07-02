import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { invalidateSettingsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getBusinessSettings, getBusinessSettingsUncached } from "@/lib/settings";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
    return unauthorized();
  }

  const settings = await getBusinessSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
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
  ];
  for (const f of fields) {
    if (f in payload) update[f] = stringOrNull(payload[f]);
  }
  if ("enable_skroutz" in payload) {
    update.enable_skroutz = payload.enable_skroutz === true;
  }
  if ("feed_min_stock" in payload) {
    update.feed_min_stock = Math.max(1, Math.trunc(Number(payload.feed_min_stock) || 1));
  }

  // Get the existing row id
  const existing = await getBusinessSettings();

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
