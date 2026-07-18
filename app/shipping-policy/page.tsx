import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getLanguage } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { buildLanguageAlternates } from "@/lib/storefront-seo";
type Props = { searchParams: Promise<{ lang?: string }> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> { const language = getLanguage((await searchParams).lang); return { title: language === "en" ? "Shipping Policy" : "Πολιτική Αποστολής", alternates: buildLanguageAlternates("/shipping-policy", language, {}, siteUrl()) }; }
export default async function Page({ searchParams }: Props) { const [params, settings] = await Promise.all([searchParams, getBusinessSettings()]); return <LegalPage kind="shipping" language={getLanguage(params.lang)} settings={settings} />; }
