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
    title: `${language === "en" ? "Refund Policy" : "Πολιτική Επιστροφών"} | ${settings.business_name}`,
    alternates: { canonical: `${siteUrl()}/refund-policy` },
  };
}

export default async function RefundPolicyPage({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams).lang);
  const settings = await getBusinessSettings();
  return <LegalPage kind="refund" language={language} settings={settings} />;
}
