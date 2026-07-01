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
const FEED_SAMPLE_LIMIT = Number(process.env.FEED_SAMPLE_LIMIT || 10);
const STRICT_FEED = process.env.STRICT_FEED === "true" || process.argv.includes("--strict-feed");
const reportDir = path.join(process.cwd(), "automation-reports");
const debugDir = path.join(reportDir, "debug");
fs.mkdirSync(debugDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const results = [];
const isLocalBase = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);

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

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function productBlocks(xml) {
  return Array.from(xml.matchAll(/<product>([\s\S]*?)<\/product>/gi)).map((match) => match[1]);
}

function isAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isTestSku(value) {
  const sku = String(value || "").trim().toUpperCase();
  return sku === "TEST" || sku === "DEMO" || sku.startsWith("TEST-") || sku.startsWith("TEST_") || sku.startsWith("DEMO-") || sku.startsWith("DEMO_");
}

function isPurePrice(value) {
  return /^\d+(\.\d{1,2})?$/.test(String(value || "").trim());
}

async function fetchOk(page, targetUrl, expectedType, timeout = 15000) {
  const response = await page.request.get(targetUrl, { timeout });
  if (!response.ok()) throw new Error(`${targetUrl} status ${response.status()}`);
  const contentType = response.headers()["content-type"] || "";
  if (expectedType && !contentType.toLowerCase().includes(expectedType)) {
    throw new Error(`${targetUrl} content-type ${contentType || "missing"}`);
  }
  return response;
}

async function getImageSize(page, imageUrl) {
  return page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error("image load timeout")), 12000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("image load failed"));
    };
    img.src = src;
  }), imageUrl);
}

async function auditFeed(page, xml, headers) {
  const issues = [];
  const warnings = [];
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    issues.push("XML 顶部不是 UTF-8 声明");
  }

  const contentType = headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("application/xml") || !contentType.toLowerCase().includes("charset=utf-8")) {
    issues.push(`Content-Type 应为 application/xml; charset=utf-8，当前是 ${contentType || "空"}`);
  }

  if (xml.includes("\uFFFD") || /Î|Ï|ΓÇ|鈥|锛|绠|鍟/.test(xml)) {
    issues.push("Feed 可能存在乱码字符，请检查希腊语/中文编码");
  }

  const blocks = productBlocks(xml);
  if (blocks.length === 0) issues.push("Feed 没有商品");

  for (const [index, block] of blocks.slice(0, FEED_SAMPLE_LIMIT).entries()) {
    const label = `第 ${index + 1} 个商品`;
    const sku = extractTag(block, "id") || extractTag(block, "uid");
    const price = extractTag(block, "price_with_vat") || extractTag(block, "price");
    const quantity = Number(extractTag(block, "quantity"));
    const image = extractTag(block, "image");
    const link = extractTag(block, "link");
    const instock = extractTag(block, "instock");
    const name = extractTag(block, "name");

    if (!sku) issues.push(`${label} 缺 SKU`);
    if (isTestSku(sku)) issues.push(`${label} 是测试/Demo SKU：${sku}`);
    if (!name) issues.push(`${label} 缺商品名`);
    if (!isPurePrice(price)) issues.push(`${label} 价格不是纯数字：${price || "空"}`);
    if (!Number.isFinite(quantity) || quantity <= 0) issues.push(`${label} 库存不是正数：${quantity || "空"}`);
    if (instock && instock.toUpperCase() !== "Y") issues.push(`${label} instock 不是 Y`);
    if (!isAbsoluteHttpUrl(image)) issues.push(`${label} 主图不是公网 URL：${image || "空"}`);
    if (!isAbsoluteHttpUrl(link)) issues.push(`${label} 商品链接不是公网 URL：${link || "空"}`);
    if (!isLocalBase && /localhost|127\.0\.0\.1/i.test(link)) issues.push(`${label} 商品链接仍是本地地址：${link}`);

    if (isAbsoluteHttpUrl(link)) {
      await fetchOk(page, link, "text/html");
    }

    if (isAbsoluteHttpUrl(image)) {
      await fetchOk(page, image, "image");
      const size = await getImageSize(page, image);
      if (!size || (size.width < 1000 && size.height < 1000)) {
        warnings.push(`${label} 主图尺寸不足：${size?.width || 0}x${size?.height || 0}`);
      }
    }
  }

  if (warnings.length > 0) {
    results.push({ name: "feed image dimension warnings", ok: true, warning: true, message: warnings.join("；") });
    console.warn(`WARN feed image dimension warnings: ${warnings.join("；")}`);
    if (STRICT_FEED) issues.push(...warnings);
  }

  if (issues.length > 0) throw new Error(issues.join("；"));
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

  await record("feed.xml formal audit", async () => {
    const response = await page.request.get(url("/feed.xml"), { timeout: 25000 });
    if (!response.ok()) throw new Error(`feed.xml status ${response.status()}`);
    const text = await response.text();
    if (!text.includes("<products>")) throw new Error("feed.xml does not contain products root");
    await auditFeed(page, text, response.headers());
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
  fs.writeFileSync(reportPath, JSON.stringify({ baseUrl: BASE_URL, createdAt: new Date().toISOString(), feedSampleLimit: FEED_SAMPLE_LIMIT, strictFeed: STRICT_FEED, results }, null, 2));
  console.log(`Report saved: ${reportPath}`);

  if (failed.length > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
