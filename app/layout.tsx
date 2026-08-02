import { ChatLauncher } from "@/components/chat-launcher";
import { CartProvider } from "@/components/cart-provider";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { getFeatureSettings } from "@/lib/features";
import { localizedLegalText } from "@/lib/legal-localization";
import { getPublishedLegalSettings } from "@/lib/legal-settings";
import "./globals.css";

export const metadata: Metadata = {
  title: "Online Store",
  description:
    "Selected clothing, shoes, bags and accessories from a local fashion boutique.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "Online Store",
    description:
      "Selected fashion pieces, shoes, bags and accessories with a clean Mediterranean style.",
    siteName: "Online Store",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [legal, featureSettings, requestHeaders] = await Promise.all([
    getPublishedLegalSettings(),
    getFeatureSettings(),
    headers(),
  ]);
  const language = requestHeaders.get("x-storefront-language") === "en" ? "en" : "el";
  return (
    <html lang={language}>
      <body>
        <CartProvider>
          {children}
          {featureSettings.features.ai_tools ? (
            <Suspense fallback={null}>
              <ChatLauncher />
            </Suspense>
          ) : null}
          <CookieConsentBanner language={language} config={{
            essentialDescription: localizedLegalText(legal.settings.localized, "essentialStorageDescription", language),
            analyticsEnabled: legal.settings.analyticsEnabled,
            monitoringEnabled: legal.settings.errorMonitoringEnabled,
            advertisingEnabled: legal.settings.advertisingEnabled,
            legalVersion: legal.currentVersion,
          }} />
        </CartProvider>
      </body>
    </html>
  );
}
