import type { BusinessSettings } from "@/lib/settings";

export type LegalConfig = {
  businessName: string;
  legalName: string;
  businessAddress: string;
  vatNumber: string;
  gemiNumber: string;
  contactEmail: string;
  phone: string;
  country: string;
  dataControllerName: string;
  dataControllerAddress: string;
  dataProcessors: string[];
  paymentProviders: string[];
  analyticsProviders: string[];
  aiProviders: string[];
  dataRetention: string;
  lastUpdated: string;
};

export const legalLinks = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Service" },
  { href: "/cookie-policy", label: "Cookie Policy" },
  { href: "/contact", label: "Contact" },
  { href: "/refund-policy", label: "Refund Policy" },
] as const;

function listFromEnv(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function getLegalConfig(settings: BusinessSettings): LegalConfig {
  const businessName = process.env.NEXT_PUBLIC_LEGAL_BUSINESS_NAME || settings.business_name || "Business name to be confirmed";
  const legalName = process.env.NEXT_PUBLIC_LEGAL_NAME || process.env.LEGAL_NAME || businessName;
  const businessAddress = process.env.NEXT_PUBLIC_LEGAL_ADDRESS || process.env.LEGAL_ADDRESS || settings.address || "Business address to be confirmed";
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || process.env.CONTACT_EMAIL || "contact email to be confirmed";
  const phone = process.env.NEXT_PUBLIC_LEGAL_PHONE || process.env.LEGAL_PHONE || settings.phone || "";
  const country = process.env.NEXT_PUBLIC_LEGAL_COUNTRY || process.env.LEGAL_COUNTRY || "Greece";

  const paymentProviders = listFromEnv("NEXT_PUBLIC_LEGAL_PAYMENT_PROVIDERS");
  const analyticsProviders = listFromEnv("NEXT_PUBLIC_LEGAL_ANALYTICS_PROVIDERS");
  const aiProviders = listFromEnv("NEXT_PUBLIC_LEGAL_AI_PROVIDERS");
  const dataProcessors = unique([
    "Supabase",
    "Vercel",
    ...listFromEnv("NEXT_PUBLIC_LEGAL_DATA_PROCESSORS"),
    ...paymentProviders,
    ...analyticsProviders,
    ...aiProviders,
  ]);

  return {
    businessName,
    legalName,
    businessAddress,
    vatNumber: process.env.NEXT_PUBLIC_LEGAL_VAT_NUMBER || process.env.LEGAL_VAT_NUMBER || "",
    gemiNumber: process.env.NEXT_PUBLIC_LEGAL_GEMI_NUMBER || process.env.LEGAL_GEMI_NUMBER || "",
    contactEmail,
    phone,
    country,
    dataControllerName: process.env.NEXT_PUBLIC_LEGAL_DATA_CONTROLLER_NAME || process.env.LEGAL_DATA_CONTROLLER_NAME || legalName,
    dataControllerAddress: process.env.NEXT_PUBLIC_LEGAL_DATA_CONTROLLER_ADDRESS || process.env.LEGAL_DATA_CONTROLLER_ADDRESS || businessAddress,
    dataProcessors,
    paymentProviders,
    analyticsProviders,
    aiProviders,
    dataRetention: process.env.NEXT_PUBLIC_LEGAL_DATA_RETENTION || process.env.LEGAL_DATA_RETENTION || "Records are kept only for as long as needed for store operations, legal obligations, accounting, fraud prevention, and support.",
    lastUpdated: process.env.NEXT_PUBLIC_LEGAL_LAST_UPDATED || process.env.LEGAL_LAST_UPDATED || "2026-07-05",
  };
}
