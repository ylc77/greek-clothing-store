import { CheckoutPageClient } from "@/components/checkout-page-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getLanguage } from "@/lib/i18n";
import { getPublishedLegalSettings } from "@/lib/legal-settings";
import { getBusinessSettings } from "@/lib/settings";

export default async function CheckoutPage({searchParams}:{searchParams:Promise<{lang?:string}>}){const language=getLanguage((await searchParams).lang);const[settings,legal]=await Promise.all([getBusinessSettings(),getPublishedLegalSettings()]);return <main className="min-h-screen bg-paper"><SiteHeader language={language} settings={settings}/><CheckoutPageClient language={language} legalReady={legal.complete&&Boolean(legal.currentVersion)} settings={settings}/><SiteFooter language={language} settings={settings}/></main>;}
