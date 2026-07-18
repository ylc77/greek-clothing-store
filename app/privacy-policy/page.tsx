import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getLanguage } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { buildLanguageAlternates } from "@/lib/storefront-seo";

type PageProps = {
  searchParams: Promise<{ lang?: string }>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  return {
    title: `${language === "en" ? "Privacy Policy" : "Πολιτική Απορρήτου"} | ${settings.business_name}`,
    alternates: buildLanguageAlternates("/privacy-policy", language, {}, siteUrl()),
  };
}

export default async function PrivacyPolicyPage({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  return <LegalPage kind="privacy" language={language} settings={settings} />;
}
