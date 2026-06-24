import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep sharp as external so its native .so files survive Vercel's output tracing
  serverExternalPackages: ["sharp"],
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
