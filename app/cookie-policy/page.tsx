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
    title: `${language === "en" ? "Cookie Policy" : "Πολιτική Cookies"} | ${settings.business_name}`,
    alternates: { canonical: `${siteUrl()}/cookie-policy` },
  };
}

export default async function CookiePolicyPage({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  return <LegalPage kind="cookies" language={language} settings={settings} />;
}
