import { ChatLauncher } from "@/components/chat-launcher";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { getFeatureSettings } from "@/lib/features";
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
  const [legal, featureSettings] = await Promise.all([
    getPublishedLegalSettings(),
    getFeatureSettings(),
  ]);
  return (
    <html lang="el" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var p=(new URL(window.location)).searchParams;document.documentElement.lang=p.get("lang")==="en"?"en":"el"})()`,
          }}
        />
      </head>
      <body>
        {children}
        {featureSettings.features.ai_tools ? (
          <Suspense fallback={null}>
            <ChatLauncher />
          </Suspense>
        ) : null}
        <CookieConsentBanner config={{
          essentialDescription: legal.settings.essentialStorageDescription,
          analyticsEnabled: legal.settings.analyticsEnabled,
          monitoringEnabled: legal.settings.errorMonitoringEnabled,
          advertisingEnabled: legal.settings.advertisingEnabled,
          legalVersion: legal.currentVersion,
        }} />
      </body>
    </html>
  );
}
