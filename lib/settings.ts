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
  pickup_instructions_en: "Pay when you collect your order from the store.",
  pickup_instructions_gr: "Πληρώστε κατά την παραλαβή της παραγγελίας σας από το κατάστημα.",
  delivery_instructions_en: "Pay cash when your order is delivered.",
  delivery_instructions_gr: "Πληρώστε με μετρητά κατά την παράδοση της παραγγελίας σας.",
  order_notification_email: "",
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
