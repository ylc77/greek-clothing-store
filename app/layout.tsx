import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Helios Wear",
  description: "Greek clothing store MVP."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="el">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
