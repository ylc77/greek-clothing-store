/* eslint-disable no-console */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, request } from "playwright";

const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
const failures = [];
const warnings = [];
const expectDynamicCategoryFixture = process.env.EXPECT_DYNAMIC_CATEGORY_FIXTURE === "true";

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function hasLink(html, rel, href, hreflang = null) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  return tags.some((tag) => {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i)?.[1] || "";
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    const languageMatch = tag.match(/\bhreflang=["']([^"']+)["']/i)?.[1] || "";
    return relMatch.split(/\s+/).includes(rel)
      && hrefMatch === href
      && (hreflang === null || languageMatch === hreflang);
  });
}

async function check(name, callback) {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name}: ${message}`);
  }
}

function axeSummary(violations) {
  return violations.map((violation) => {
    const targets = violation.nodes.slice(0, 12).map((node) => node.target.join(" ")).join(", ");
    return `${violation.id}(${violation.nodes.length}): ${targets}`;
  }).join(" | ");
}

async function rawPage(api, route, language, pathname) {
  const response = await api.get(`${baseUrl}${route}`);
  expect(response.ok(), `${route} returned ${response.status()}`);
  const html = await response.text();
  expect(new RegExp(`<html[^>]+lang=["']${language}["']`, "i").test(html), `${route} raw HTML lang is not ${language}`);
  const greekUrl = `${baseUrl}${pathname}`;
  const englishUrl = `${baseUrl}${pathname}?lang=en`;
  const canonical = language === "en" ? englishUrl : greekUrl;
  expect(hasLink(html, "canonical", canonical), `${route} canonical is not ${canonical}`);
  expect(hasLink(html, "alternate", greekUrl, "el-GR"), `${route} is missing Greek hreflang`);
  expect(hasLink(html, "alternate", englishUrl, "en"), `${route} is missing English hreflang`);
  expect(hasLink(html, "alternate", greekUrl, "x-default"), `${route} is missing x-default hreflang`);
  return { response, html };
}

const api = await request.newContext();

for (const pathname of ["/", "/contact", "/privacy-policy", "/terms-of-service", "/cookie-policy", "/shipping-policy", "/return-policy", "/refund-policy"]) {
  const label = pathname === "/" ? "home" : pathname.slice(1);
  await check(`${label} Greek raw metadata`, () => rawPage(api, pathname, "el", pathname));
  await check(`${label} English raw metadata`, () => rawPage(api, `${pathname}${pathname.includes("?") ? "&" : "?"}lang=en`, "en", pathname));
}

if (expectDynamicCategoryFixture) {
  await check("dynamic category Greek raw metadata", () => rawPage(api, "/seasonal", "el", "/seasonal"));
  await check("dynamic category English raw metadata", () => rawPage(api, "/seasonal?lang=en", "en", "/seasonal"));
}

await check("security response headers", async () => {
  const response = await api.get(`${baseUrl}/`);
  const headers = response.headers();
  const csp = headers["content-security-policy"] || "";
  expect(/default-src 'self'/.test(csp), "CSP default-src is missing");
  expect(/script-src 'self' 'nonce-[^']+'/.test(csp), "CSP request nonce is missing");
  expect(/frame-ancestors 'none'/.test(csp), "CSP frame-ancestors is missing");
  expect(headers["x-frame-options"] === "DENY", "X-Frame-Options is not DENY");
  expect(headers["x-content-type-options"] === "nosniff", "nosniff is missing");
  expect(headers["referrer-policy"] === "strict-origin-when-cross-origin", "Referrer-Policy is incorrect");
  expect(Boolean(headers["permissions-policy"]), "Permissions-Policy is missing");
});

await check("admin is noindex in HTML and response headers", async () => {
  const response = await api.get(`${baseUrl}/admin`);
  expect(response.ok(), `/admin returned ${response.status()}`);
  const html = await response.text();
  expect(/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)
    || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots/i.test(html), "admin raw HTML robots noindex is missing");
  expect((response.headers()["x-robots-tag"] || "").includes("noindex"), "admin X-Robots-Tag noindex is missing");
});

const browser = await chromium.launch({ headless: true });
for (const viewport of [
  { width: 390, height: 844, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1440, height: 1000, label: "desktop" },
]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await check(`${viewport.label} storefront axe and overflow`, async () => {
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    const serious = (await new AxeBuilder({ page }).analyze()).violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    expect(serious.length === 0, `axe violations: ${axeSummary(serious)}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow <= 1, `horizontal overflow is ${overflow}px`);
    if (expectDynamicCategoryFixture) {
      expect(await page.locator("[data-storefront-category-card]").count() === 10, "homepage does not render all 10 active categories");
      expect(await page.locator("[data-storefront-mobile-categories] a").count() === 10, "mobile category navigation does not contain all 10 active categories");
    }
  });
  if (viewport.label === "desktop") {
    if (expectDynamicCategoryFixture) {
      await check("desktop category overflow menu and dynamic route", async () => {
        const more = page.locator("[data-storefront-category-more]");
        await more.hover();
        const seasonalLink = page.locator('[data-storefront-category-overflow] a[href="/seasonal"]');
        await seasonalLink.waitFor({ state: "visible" });
        await Promise.all([
          page.waitForURL((url) => url.pathname === "/seasonal"),
          seasonalLink.click(),
        ]);
        expect(await page.getByRole("heading", { name: "Εποχιακά" }).count() > 0, "dynamic category page heading is missing");
        expect(await page.getByRole("link", { name: "Εποχιακές εκπτώσεις" }).count() > 0, "dynamic subcategory filter is missing");
      });
    }
    await check("admin login keyboard labels", async () => {
      await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
      const firstCredentialInput = page.getByLabel(/员工邮箱|管理员应急密码/).first();
      await firstCredentialInput.waitFor();
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      const focusOrder = [];
      for (let index = 0; index < 8; index += 1) {
        await page.keyboard.press("Tab");
        focusOrder.push(await page.evaluate(() => ({
          tag: document.activeElement?.tagName || "",
          id: document.activeElement?.id || "",
          text: document.activeElement?.textContent?.trim() || "",
        })));
      }
      expect(focusOrder.some((item) => item.tag === "INPUT" && item.id.startsWith("admin-")), "keyboard navigation never reaches a labelled credential input");
      expect(focusOrder.some((item) => item.tag === "BUTTON" && /登录/.test(item.text)), "keyboard navigation never reaches the login button");
      const serious = (await new AxeBuilder({ page }).analyze()).violations
        .filter((violation) => violation.impact === "critical" || violation.impact === "serious");
      expect(serious.length === 0, `admin axe violations: ${axeSummary(serious)}`);
    });
  }
  if (consoleErrors.length > 0) warnings.push(`${viewport.label}: ${consoleErrors.join(" | ")}`);
  await context.close();
}
await browser.close();
await api.dispose();

if (warnings.length > 0) console.warn(`WARN browser console errors: ${warnings.join(" ; ")}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} channel browser check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Channel SEO, legal, security-header and accessibility browser checks passed.");
