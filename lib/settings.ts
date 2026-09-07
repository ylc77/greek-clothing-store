/**
 * Server-side business settings loader.
 *
 * Reads a single row from `business_settings`.  If the table or row is
 * missing the function returns sensible defaults so the front-end never
 * breaks — deploy the SQL migration first, then re-deploy the app.
 */

import { unstable_cache } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";
import { storefrontText } from "@/lib/i18n";
import { getSupabaseClient } from "@/lib/supabase";

export type BusinessSettings = {
  id: string;
  business_name: string;
  logo_url: string;
  hero_image_url: string;
  description_cn: string;
  description_en: string;
  description_gr: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  address: string;
  google_maps_url: string;
  opening_hours: string;
  footer_text: string;
  online_store_enabled: boolean;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  shipping_fee: number;
  free_shipping_threshold: number | null;
  pickup_instructions_en: string;
  pickup_instructions_gr: string;
  delivery_instructions_en: string;
  delivery_instructions_gr: string;
  order_notification_email: string;
  viva_payments_enabled: boolean;
  boxnow_enabled: boolean;
  boxnow_minimum_subtotal: number;
  boxnow_shipping_fee: number;
  boxnow_free_shipping_threshold: number | null;
  boxnow_max_items: number;
  boxnow_max_weight_grams: number;
  boxnow_max_length_mm: number;
  boxnow_max_width_mm: number;
  boxnow_max_height_mm: number;
  pickup_hold_days: number;
};

const defaults: BusinessSettings = {
  id: "00000000-0000-0000-0000-000000000000",
  business_name: "Online Store",
  logo_url: "",
  hero_image_url: "",
  description_cn: "",
  description_en: "Curated clothing, shoes, bags and accessories with a clean Mediterranean feel.",
  description_gr: "Επιλεγμένα ρούχα, παπούτσια, τσάντες και αξεσουάρ με καθαρή μεσογειακή αισθητική.",
  phone: "",
  whatsapp: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  address: "",
  google_maps_url: "",
  opening_hours: "",
  footer_text: "",
  online_store_enabled: false,
  delivery_enabled: true,
  pickup_enabled: true,
  shipping_fee: 0,
  free_shipping_threshold: null,
  pickup_instructions_en: "Pay securely online, then collect after the store confirms your order is ready.",
  pickup_instructions_gr: "Πληρώστε με ασφάλεια online και παραλάβετε αφού το κατάστημα επιβεβαιώσει ότι η παραγγελία είναι έτοιμη.",
  delivery_instructions_en: "Legacy delivery instructions. BOX NOW settings are configured separately.",
  delivery_instructions_gr: "Οδηγίες παλαιάς παράδοσης. Το BOX NOW ρυθμίζεται ξεχωριστά.",
  order_notification_email: "",
  viva_payments_enabled: false,
  boxnow_enabled: false,
  boxnow_minimum_subtotal: 15,
  boxnow_shipping_fee: 2.5,
  boxnow_free_shipping_threshold: 39,
  boxnow_max_items: 10,
  boxnow_max_weight_grams: 20_000,
  boxnow_max_length_mm: 600,
  boxnow_max_width_mm: 450,
  boxnow_max_height_mm: 360,
  pickup_hold_days: 3,
};

const SETTINGS_SELECT = [
  "id",
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
  "online_store_enabled",
  "delivery_enabled",
  "pickup_enabled",
  "shipping_fee",
  "free_shipping_threshold",
  "pickup_instructions_en",
  "pickup_instructions_gr",
  "delivery_instructions_en",
  "delivery_instructions_gr",
  "order_notification_email",
  "viva_payments_enabled",
  "boxnow_enabled",
  "boxnow_minimum_subtotal",
  "boxnow_shipping_fee",
  "boxnow_free_shipping_threshold",
  "boxnow_max_items",
  "boxnow_max_weight_grams",
  "boxnow_max_length_mm",
  "boxnow_max_width_mm",
  "boxnow_max_height_mm",
  "pickup_hold_days",
].join(",");

async function loadBusinessSettings(): Promise<BusinessSettings> {
  const supabase = getSupabaseClient();
  if (!supabase) return defaults;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("business_settings")
    .select(SETTINGS_SELECT)
    .limit(1)
    .single();

  if (!data) {
    return defaults;
  }

  const settings: BusinessSettings = {
    id: String(data.id ?? ""),
    business_name: storefrontText(data.business_name, defaults.business_name),
    logo_url: String(data.logo_url || ""),
    hero_image_url: String(data.hero_image_url || ""),
    description_cn: String(data.description_cn || ""),
    description_en: storefrontText(data.description_en, defaults.description_en),
    description_gr: storefrontText(data.description_gr, defaults.description_gr),
    phone: String(data.phone || ""),
    whatsapp: String(data.whatsapp || ""),
    instagram: String(data.instagram || ""),
    facebook: String(data.facebook || ""),
    tiktok: String(data.tiktok || ""),
    address: storefrontText(data.address),
    google_maps_url: String(data.google_maps_url || ""),
    opening_hours: storefrontText(data.opening_hours),
    footer_text: storefrontText(data.footer_text),
    online_store_enabled: data.online_store_enabled === true,
    delivery_enabled: data.delivery_enabled !== false,
    pickup_enabled: data.pickup_enabled !== false,
    shipping_fee: Math.max(0, Number(data.shipping_fee || 0)),
    free_shipping_threshold: data.free_shipping_threshold == null ? null : Math.max(0, Number(data.free_shipping_threshold)),
    pickup_instructions_en: storefrontText(data.pickup_instructions_en, defaults.pickup_instructions_en),
    pickup_instructions_gr: storefrontText(data.pickup_instructions_gr, defaults.pickup_instructions_gr),
    delivery_instructions_en: storefrontText(data.delivery_instructions_en, defaults.delivery_instructions_en),
    delivery_instructions_gr: storefrontText(data.delivery_instructions_gr, defaults.delivery_instructions_gr),
    order_notification_email: String(data.order_notification_email || ""),
    viva_payments_enabled: data.viva_payments_enabled === true,
    boxnow_enabled: data.boxnow_enabled === true,
    boxnow_minimum_subtotal: Math.max(0, Number(data.boxnow_minimum_subtotal ?? 15)),
    boxnow_shipping_fee: Math.max(0, Number(data.boxnow_shipping_fee ?? 2.5)),
    boxnow_free_shipping_threshold: data.boxnow_free_shipping_threshold == null ? null : Math.max(0, Number(data.boxnow_free_shipping_threshold)),
    boxnow_max_items: Math.max(1, Math.trunc(Number(data.boxnow_max_items ?? 10))),
    boxnow_max_weight_grams: Math.max(1, Math.trunc(Number(data.boxnow_max_weight_grams ?? 20_000))),
    boxnow_max_length_mm: Math.max(1, Math.trunc(Number(data.boxnow_max_length_mm ?? 600))),
    boxnow_max_width_mm: Math.max(1, Math.trunc(Number(data.boxnow_max_width_mm ?? 450))),
    boxnow_max_height_mm: Math.max(1, Math.trunc(Number(data.boxnow_max_height_mm ?? 360))),
    pickup_hold_days: Math.max(1, Math.trunc(Number(data.pickup_hold_days ?? 3))),
  };

  return settings;
}

const getBusinessSettingsCached = unstable_cache(
  loadBusinessSettings,
  ["business-settings"],
  { revalidate: 60, tags: [cacheTags.settings] },
);

export async function getBusinessSettings(): Promise<BusinessSettings> {
  return getBusinessSettingsCached();
}

export async function getBusinessSettingsUncached(): Promise<BusinessSettings> {
  return loadBusinessSettings();
}

/** Invalidate cache (call after admin update). Used in server actions too. */
export function clearSettingsCache() {
  // Kept for compatibility with older imports. Next cache invalidation is handled
  // by revalidateTag(cacheTags.settings) from route handlers.
}
