/**
 * Server-side business settings loader.
 *
 * Reads a single row from `business_settings`.  If the table or row is
 * missing the function returns sensible defaults so the front-end never
 * breaks — deploy the SQL migration first, then re-deploy the app.
 */

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
  enable_skroutz: boolean;
};

const defaults: BusinessSettings = {
  id: crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-0000-0000-000000000000",
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
  enable_skroutz: false,
};

let cached: BusinessSettings | null = null;
let cacheTime = 0;
const TTL = 30_000; // 30 seconds

export async function getBusinessSettings(): Promise<BusinessSettings> {
  if (cached && Date.now() - cacheTime < TTL) return cached;

  const supabase = getSupabaseClient();
  if (!supabase) return defaults;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("business_settings")
    .select("*")
    .limit(1)
    .single();

  if (!data) {
    cached = defaults;
    cacheTime = Date.now();
    return defaults;
  }

  const settings: BusinessSettings = {
    id: String(data.id ?? ""),
    business_name: String(data.business_name || defaults.business_name),
    logo_url: String(data.logo_url || ""),
    hero_image_url: String(data.hero_image_url || ""),
    description_cn: String(data.description_cn || ""),
    description_en: String(data.description_en || defaults.description_en),
    description_gr: String(data.description_gr || defaults.description_gr),
    phone: String(data.phone || ""),
    whatsapp: String(data.whatsapp || ""),
    instagram: String(data.instagram || ""),
    facebook: String(data.facebook || ""),
    tiktok: String(data.tiktok || ""),
    address: String(data.address || ""),
    google_maps_url: String(data.google_maps_url || ""),
    opening_hours: String(data.opening_hours || ""),
    footer_text: String(data.footer_text || ""),
    enable_skroutz: data.enable_skroutz === true,
  };

  cached = settings;
  cacheTime = Date.now();
  return settings;
}

/** Invalidate cache (call after admin update). Used in server actions too. */
export function clearSettingsCache() {
  cached = null;
  cacheTime = 0;
}
