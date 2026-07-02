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
