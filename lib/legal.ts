import type { LegalProviderKey, ProjectType } from "@/lib/legal-settings";

export const providerNames: Record<LegalProviderKey, string> = {
  supabase: "Supabase",
  vercel: "Vercel",
  stripe: "Stripe",
  viva: "Viva",
  cash: "Cash / 现金",
  pos: "Card terminal / POS",
  posthog: "PostHog",
  sentry: "Sentry",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

const commonLinks = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Service" },
  { href: "/cookie-policy", label: "Cookie Policy" },
  { href: "/contact", label: "Contact" },
] as const;

export function getLegalLinks(projectType: ProjectType) {
  return projectType === "restaurant"
    ? [...commonLinks, { href: "/cancellation-policy", label: "Cancellation Policy" }]
    : [
        ...commonLinks,
        { href: "/refund-policy", label: "Refund Policy" },
        { href: "/return-policy", label: "Return Policy" },
        { href: "/shipping-policy", label: "Shipping Policy" },
      ];
}
