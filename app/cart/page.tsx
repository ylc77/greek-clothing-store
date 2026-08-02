import { CartPageClient } from "@/components/cart-page-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getFeatureSettings } from "@/lib/features";
import { getLanguage } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const language=getLanguage((await searchParams).lang);
  const [settings,features]=await Promise.all([getBusinessSettings(),getFeatureSettings()]);
  return <main className="min-h-screen bg-paper"><SiteHeader language={language} settings={settings}/><CartPageClient language={language} onlineStoreEnabled={features.features.online_orders&&settings.online_store_enabled}/><SiteFooter language={language} settings={settings}/></main>;
}
