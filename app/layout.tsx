import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Helios Wear — Greek Fashion Store",
  description:
    "Curated clothing, shoes, bags and accessories from Greece. Browse our collection and shop via WhatsApp or Skroutz.",
  openGraph: {
    title: "Helios Wear",
    description:
      "Curated clothing, shoes, bags and accessories with a clean Mediterranean feel.",
    siteName: "Helios Wear",
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
