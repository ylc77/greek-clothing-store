/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm install && npx playwright install chromium");
  process.exit(1);
}

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const reportDir = path.join(process.cwd(), "automation-reports");
const debugDir = path.join(reportDir, "debug");
fs.mkdirSync(debugDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const results = [];

function url(route) {
  return `${BASE_URL}${route.startsWith("/") ? route : `/${route}`}`;
}

async function record(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`OK ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, message });
    console.error(`FAIL ${name}: ${message}`);
    return false;
  }
  return true;
}

async function screenshot(page, name) {
  const file = path.join(debugDir, `${timestamp}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function assertPageLoaded(page, route, marker) {
  const response = await page.goto(url(route), { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!response || response.status() >= 400) throw new Error(`${route} status ${response?.status()}`);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  if (marker) await page.locator(marker).first().waitFor({ timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await record("home page", async () => {
    await assertPageLoaded(page, "/", "body");
    const title = await page.title();
    if (!title) throw new Error("Missing page title");
  });

  await record("category page", async () => {
    await assertPageLoaded(page, "/men", "body");
  });

  await record("product detail link", async () => {
    await assertPageLoaded(page, "/", "main");
    const productLink = page.locator('a[href^="/product/"], a[href*="/product/"]').first();
    if ((await productLink.count()) === 0) {
      results.push({ name: "product detail available", ok: true, skipped: true, message: "No product detail link found" });
      console.log("SKIP product detail: no product link found");
      return;
    }
    await productLink.click({ timeout: 8000 });
    await page.waitForURL(/\/product\//, { timeout: 10000 });
    await page.locator("main").first().waitFor({ timeout: 8000 });
  });

  await record("contact page", async () => {
    await assertPageLoaded(page, "/contact", "body");
  });

  await record("feed.xml", async () => {
    const response = await page.goto(url("/feed.xml"), { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response || response.status() !== 200) throw new Error(`feed.xml status ${response?.status()}`);
    const text = await page.locator("body").textContent();
    if (!text || !text.includes("<products>")) throw new Error("feed.xml does not contain products root");
  });

  await record("sitemap.xml", async () => {
    const response = await page.goto(url("/sitemap.xml"), { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response || response.status() !== 200) throw new Error(`sitemap.xml status ${response?.status()}`);
  });

  await record("robots.txt", async () => {
    const response = await page.goto(url("/robots.txt"), { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response || response.status() !== 200) throw new Error(`robots.txt status ${response?.status()}`);
  });

  await record("admin page", async () => {
    await assertPageLoaded(page, "/admin", "body");
    if (!ADMIN_PASSWORD) {
      results.push({ name: "admin login", ok: true, skipped: true, message: "ADMIN_PASSWORD not set" });
      console.log("SKIP admin login: ADMIN_PASSWORD not set");
      return;
    }
    const input = page.locator('input[type="password"]').first();
    await input.fill(ADMIN_PASSWORD);
    await page.locator("button").filter({ hasText: /登录|Login/i }).first().click();
    await page.locator("text=/商品管理后台|Fashion Store Admin/").first().waitFor({ timeout: 10000 });
  });

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) await screenshot(page, "failed-final");
  await browser.close();

  const reportPath = path.join(reportDir, `site-smoke-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ baseUrl: BASE_URL, createdAt: new Date().toISOString(), results }, null, 2));
  console.log(`Report saved: ${reportPath}`);

  if (failed.length > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
