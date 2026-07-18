function safeSupabaseOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(
  nonce: string,
  supabaseUrl: string | null | undefined,
  development: boolean,
) {
  const supabaseOrigin = safeSupabaseOrigin(supabaseUrl);
  const supabaseSocket = supabaseOrigin?.replace(/^https:/, "wss:");
  const connectSources = [
    "'self'",
    supabaseOrigin,
    supabaseSocket,
    "https://vercel.live",
    "wss://ws-us3.pusher.com",
  ].filter(Boolean).join(" ");
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    development ? "'unsafe-eval'" : null,
    "https://vercel.live",
  ].filter(Boolean).join(" ");
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' https://vercel.live",
    "frame-ancestors 'none'",
    development ? null : "upgrade-insecure-requests",
  ].filter(Boolean);
  return directives.join("; ");
}

export function securityResponseHeaders(contentSecurityPolicy: string, privateRoute: boolean) {
  return {
    "Content-Security-Policy": contentSecurityPolicy,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(privateRoute ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
  };
}
