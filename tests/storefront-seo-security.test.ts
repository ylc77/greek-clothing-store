import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { buildLanguageAlternates, localizedStorefrontUrl } from "../lib/storefront-seo.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { buildContentSecurityPolicy, securityResponseHeaders } from "../lib/security-headers.ts";

test("Greek and English storefront URLs have stable canonicals and reciprocal hreflang", () => {
  const greek = buildLanguageAlternates("/women", "el", { subcategory: "dresses" }, "https://shop.example");
  const english = buildLanguageAlternates("/women", "en", { subcategory: "dresses" }, "https://shop.example");

  assert.equal(greek.canonical, "https://shop.example/women?subcategory=dresses");
  assert.equal(english.canonical, "https://shop.example/women?subcategory=dresses&lang=en");
  assert.deepEqual(greek.languages, {
    "el-GR": "https://shop.example/women?subcategory=dresses",
    en: "https://shop.example/women?subcategory=dresses&lang=en",
    "x-default": "https://shop.example/women?subcategory=dresses",
  });
  assert.deepEqual(english.languages, greek.languages);
});

test("localized URL removes stale language values and preserves allowed query state", () => {
  assert.equal(
    localizedStorefrontUrl("/product/ABC", "en", { lang: "el", ignored: undefined }, "https://shop.example/"),
    "https://shop.example/product/ABC?lang=en",
  );
  assert.equal(
    localizedStorefrontUrl("/privacy-policy", "el", { lang: "en" }, "https://shop.example"),
    "https://shop.example/privacy-policy",
  );
});

test("security headers use a per-response nonce and fail closed for framing and object content", () => {
  const csp = buildContentSecurityPolicy("nonce-value", "https://project.supabase.co", false);
  assert.match(csp, /script-src 'self' 'nonce-nonce-value'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/project\.supabase\.co wss:\/\/project\.supabase\.co/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /unsafe-eval/);

  const headers = securityResponseHeaders(csp, true);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Robots-Tag"], "noindex, nofollow, noarchive");
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
});
