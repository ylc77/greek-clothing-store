import type { LegalProviderKey } from "@/lib/legal-settings";
import type { Language } from "@/lib/i18n";

export const providerNames: Record<LegalProviderKey, string> = {
  supabase: "Supabase",
  vercel: "Vercel",
  stripe: "Stripe",
  viva: "Viva",
  cash: "Cash",
  pos: "Card terminal / POS",
  posthog: "PostHog",
  sentry: "Sentry",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export function getLegalLinks(language: Language) {
  const en = language === "en";
  return [
    { href: "/privacy-policy", label: en ? "Privacy Policy" : "Πολιτική Απορρήτου" },
    { href: "/terms-of-service", label: en ? "Terms of Sale" : "Όροι Πώλησης" },
    { href: "/cookie-policy", label: en ? "Cookie Policy" : "Πολιτική Cookies" },
    { href: "/contact", label: en ? "Contact" : "Επικοινωνία" },
    { href: "/shipping-policy", label: en ? "Shipping Policy" : "Πολιτική Αποστολής" },
    { href: "/return-policy", label: en ? "Return Policy" : "Πολιτική Επιστροφών" },
    { href: "/refund-policy", label: en ? "Refund Policy" : "Πολιτική Επιστροφής Χρημάτων" },
  ];
}
