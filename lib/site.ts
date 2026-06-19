export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

// All store-specific values (name, phone, social links, hours, etc.)
// now come from `business_settings` via `getBusinessSettings()` in lib/settings.ts.
// This file remains for the `siteUrl()` utility which is pure env-based.
