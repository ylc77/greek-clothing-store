import type { NextConfig } from "next";

function supabaseImageHostname() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "*.supabase.co";

  try {
    return new URL(url).hostname;
  } catch {
    return "*.supabase.co";
  }
}

const nextConfig: NextConfig = {
  // UI mocks must not cache a Basic plan into later real local database tests.
  distDir: process.env.ADMIN_UI_TEST_ISOLATED === "1" ? ".next-admin-ui"
    : process.env.ADMIN_INVENTORY_TEST_ISOLATED === "1" ? ".next-inventory-test" : ".next",
  // Keep sharp and its @img native deps external — @vercel/nft doesn't trace dlopen()'d .so files
  serverExternalPackages: ["sharp"],
  outputFileTracingIncludes: {
    "/api/admin/images": ["./node_modules/@img/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseImageHostname(),
        pathname: "/storage/v1/object/public/**",
      }
    ]
  }
};

export default nextConfig;
