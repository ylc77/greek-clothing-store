import { getSupabaseClient } from "@/lib/supabase";
import { getBusinessSettings } from "@/lib/settings";
import { buildSkroutzFeed, getFeedProducts } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return new Response(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const settings = await getBusinessSettings();
  if (!settings.enable_skroutz) {
    return new Response("Skroutz feed is disabled in store settings.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const brandName = settings.business_name || "Fashion Boutique";
  const products = await getFeedProducts();
  const xml = buildSkroutzFeed(products, brandName, settings.feed_min_stock);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}
