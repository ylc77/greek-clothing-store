import { ChatLauncher } from "@/components/chat-launcher";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Online Store",
  description:
    "Selected clothing, shoes, bags and accessories. Browse our collection and shop via WhatsApp or Skroutz.",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
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
        <Suspense fallback={null}>
          <ChatLauncher />
        </Suspense>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
