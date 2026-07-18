import { getBusinessSettings } from "@/lib/settings";
import { getFeedProducts, renderSkroutzFeed } from "@/lib/feed";
import { isFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await isFeatureEnabled("skroutz_feed"))) {
      return new Response("Skroutz feed is not enabled for this customer plan.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    const settings = await getBusinessSettings();
    if (!settings.enable_skroutz) {
      return new Response("Skroutz feed is disabled in store settings.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const brandName = settings.business_name || "Fashion Boutique";
    const products = await getFeedProducts(settings.feed_min_stock, brandName);
    const xml = renderSkroutzFeed(products, brandName);

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Skroutz feed generation failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Skroutz feed is temporarily unavailable.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "300",
      },
    });
  }
}
