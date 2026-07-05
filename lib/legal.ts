import type { BusinessSettings } from "@/lib/settings";

export type LegalConfig = {
  businessName: string;
  businessAddress: string;
  contactEmail: string;
  phone: string;
  country: string;
  dataProcessors: string[];
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

export function getLegalConfig(settings: BusinessSettings): LegalConfig {
  return {
    businessName: settings.business_name || "Online Store",
    businessAddress: settings.address || "Athens, Greece",
    contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || process.env.CONTACT_EMAIL || "hello@example.com",
    phone: settings.phone || "",
    country: "Greece",
    dataProcessors: [
      "Supabase",
      "Vercel",
      "OpenAI-compatible AI providers if enabled",
      "Skroutz feed tools",
      "Stripe or Viva if online payments are enabled in the future",
      "PostHog or Sentry if analytics or error monitoring are enabled in the future",
    ],
    dataRetention: "Customer and operational records are kept only for as long as needed for store operations, legal obligations, accounting, fraud prevention, and support.",
    lastUpdated: "2026-07-05",
  };
}
