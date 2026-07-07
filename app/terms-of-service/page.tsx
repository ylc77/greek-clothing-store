import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getLanguage } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";

type PageProps = {
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  return {
    title: `${language === "en" ? "Terms of Sale" : "Όροι Πώλησης"} | ${settings.business_name}`,
    alternates: { canonical: `${siteUrl()}/terms-of-service` },
  };
}

export default async function TermsOfServicePage({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  return <LegalPage kind="terms" language={language} settings={settings} />;
}
