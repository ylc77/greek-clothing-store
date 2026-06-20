import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fashion Boutique",
  description:
    "Selected clothing, shoes, bags and accessories. Browse our collection and shop via WhatsApp or Skroutz.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "Fashion Boutique",
    description:
      "Selected fashion pieces, shoes, bags and accessories with a clean Mediterranean style.",
    siteName: "Fashion Boutique",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="el">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var p=(new URL(window.location)).searchParams;document.documentElement.lang=p.get("lang")==="en"?"en":"el"})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
