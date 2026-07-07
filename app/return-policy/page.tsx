import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getLanguage } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
type Props = { searchParams: Promise<{ lang?: string }> };
export async function generateMetadata(): Promise<Metadata> { return { title: "Return Policy", alternates: { canonical: `${siteUrl()}/return-policy` } }; }
export default async function Page({ searchParams }: Props) { const [params, settings] = await Promise.all([searchParams, getBusinessSettings()]); return <LegalPage kind="return" language={getLanguage(params.lang)} settings={settings} />; }
