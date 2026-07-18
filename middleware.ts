import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, securityResponseHeaders } from "@/lib/security-headers";

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const language = request.nextUrl.searchParams.get("lang") === "en" ? "en" : "el";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-storefront-language", language);

  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV !== "production",
  );
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const privateRoute = request.nextUrl.pathname.startsWith("/admin")
    || request.nextUrl.pathname.startsWith("/api/admin");
  for (const [name, value] of Object.entries(securityResponseHeaders(csp, privateRoute))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
