import type { LegalProviderKey } from "@/lib/legal-settings";

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

const commonLinks = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Sale" },
  { href: "/cookie-policy", label: "Cookie Policy" },
  { href: "/contact", label: "Contact" },
] as const;

export function getLegalLinks() {
  return [
    ...commonLinks,
    { href: "/shipping-policy", label: "Shipping Policy" },
    { href: "/return-policy", label: "Return Policy" },
    { href: "/refund-policy", label: "Refund Policy" },
  ];
}
