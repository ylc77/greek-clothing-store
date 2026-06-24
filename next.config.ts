import type { NextConfig } from "next";

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
        hostname: "**"
      }
    ]
  }
};

export default nextConfig;
