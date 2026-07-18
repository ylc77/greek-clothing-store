/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

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

function isAbsoluteHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function isTestSku(value) {
  const sku = String(value || "").trim().toUpperCase();
  return sku === "TEST" || sku === "DEMO" || sku.startsWith("TEST-") || sku.startsWith("TEST_") || sku.startsWith("DEMO-") || sku.startsWith("DEMO_");
}

function isPurePrice(value) {
  return /^\d+(\.\d{1,2})?$/.test(String(value || "").trim());
}

async function fetchOk(page, targetUrl, expectedType, timeout = 15000, headers = {}) {
  const response = await page.request.get(targetUrl, { timeout, headers });
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

  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/u.test(xml)) {
    issues.push("Feed 包含 XML 1.0 不允许的控制字符");
  }

  let parsed;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml);
  } catch (error) {
    issues.push(`XML 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const products = asArray(parsed?.mywebstore?.products?.product);
  if (products.length === 0) issues.push("Feed 没有商品");
  const seenIds = new Set();

  for (const [index, product] of products.entries()) {
    const label = `第 ${index + 1} 个商品`;
    const sku = String(product.id || product.uid || "").trim();
    const price = String(product.price_with_vat || product.price || "").trim();
    const quantity = Number(product.quantity);
    const image = String(product.image || product.imageurl || "").trim();
    const link = String(product.link || product.url || "").trim();
    const instock = String(product.instock || "").trim();
    const name = String(product.name || "").trim();
    const description = String(product.description || "").trim();
    const category = String(product.category || "").trim();
    const manufacturer = String(product.manufacturer || "").trim();
    const mpn = String(product.mpn || product.manufacturersku || "").trim();
    const ean = String(product.ean || "").trim();
    const additionalImages = [
      ...asArray(product.additional_imageurl),
      ...asArray(product.additionalimage),
    ].map((value) => String(value || "").trim()).filter(Boolean);

    if (!sku) issues.push(`${label} 缺 SKU`);
    if (seenIds.has(sku)) issues.push(`${label} SKU 重复：${sku}`);
    seenIds.add(sku);
    if (isTestSku(sku)) issues.push(`${label} 是测试/Demo SKU：${sku}`);
    if (!name) issues.push(`${label} 缺商品名`);
    if (!description) issues.push(`${label} 缺英文商品描述`);
    if (!category) issues.push(`${label} 缺英文分类路径`);
    if (!manufacturer) issues.push(`${label} 缺真实制造商/品牌`);
    if (manufacturer && !name.toLocaleLowerCase("en").includes(manufacturer.toLocaleLowerCase("en"))) issues.push(`${label} 商品名未包含制造商/品牌：${manufacturer}`);
    if (!mpn || mpn.length > 80) issues.push(`${label} MPN 缺失或超过 80 字符`);
    if (!/^(?:\d{8}|\d{13})$/.test(ean)) issues.push(`${label} EAN 不是 8 或 13 位数字：${ean || "空"}`);
    if (!isPurePrice(price)) issues.push(`${label} 价格不是纯数字：${price || "空"}`);
    if (!Number.isFinite(quantity) || quantity <= 0) issues.push(`${label} 库存不是正数：${quantity || "空"}`);
    if (instock && instock.toUpperCase() !== "Y") issues.push(`${label} instock 不是 Y`);
    if (!isAbsoluteHttpsUrl(image)) issues.push(`${label} 主图不是 HTTPS 公网 URL：${image || "空"}`);
    if (/\.avif(?:$|\?)/i.test(image)) issues.push(`${label} 主图使用了 Skroutz 不支持的 AVIF`);
    if (!isAbsoluteHttpsUrl(link)) issues.push(`${label} 商品链接不是 HTTPS 公网 URL：${link || "空"}`);
    if (!isLocalBase && /localhost|127\.0\.0\.1/i.test(link)) issues.push(`${label} 商品链接仍是本地地址：${link}`);

    const variations = asArray(product.variations?.variation);
    if (variations.length > 0) {
      if (additionalImages.length === 0) issues.push(`${label} 有尺码但缺少服装类必需的附加图片`);
      if (additionalImages.length > 15) issues.push(`${label} 附加图片超过 15 张`);
      const variationIds = new Set();
      let variationQuantity = 0;
      for (const variation of variations) {
        const variationId = String(variation.variationid || "").trim();
        const variationSize = String(variation.size || "").trim();
        const variationAvailability = String(variation.availability || "").trim();
        const variationStock = Number(variation.quantity);
        if (!variationId || variationIds.has(variationId)) issues.push(`${label} Variant ID 缺失或重复：${variationId || "空"}`);
        variationIds.add(variationId);
        if (!variationSize) issues.push(`${label} Variant ${variationId || "未知"} 缺尺码`);
        if (!variationAvailability) issues.push(`${label} Variant ${variationId || "未知"} 缺可用性`);
        if (!Number.isInteger(variationStock) || variationStock <= 0) issues.push(`${label} Variant ${variationId || "未知"} 库存不是正整数`);
        else variationQuantity += variationStock;
      }
      if (variationQuantity !== quantity) issues.push(`${label} 父商品库存 ${quantity} 与尺码库存合计 ${variationQuantity} 不一致`);
    }

    if (index < FEED_SAMPLE_LIMIT && isAbsoluteHttpsUrl(link)) {
      await fetchOk(page, link, "text/html");
    }

    if (index < FEED_SAMPLE_LIMIT && isAbsoluteHttpsUrl(image)) {
      await fetchOk(page, image, "image", 15000, { "user-agent": "Skroutz ImageBot v1" });
      const size = await getImageSize(page, image);
      if (!size || (size.width <= 1000 && size.height <= 1000)) {
        warnings.push(`${label} 主图尺寸不足：${size?.width || 0}x${size?.height || 0}`);
      }
    }
    for (const additionalImage of additionalImages) {
      if (!isAbsoluteHttpsUrl(additionalImage)) issues.push(`${label} 附加图片不是 HTTPS 公网 URL：${additionalImage}`);
      if (/\.avif(?:$|\?)/i.test(additionalImage)) issues.push(`${label} 附加图片使用了 Skroutz 不支持的 AVIF`);
    }
    if (index < FEED_SAMPLE_LIMIT && additionalImages[0] && isAbsoluteHttpsUrl(additionalImages[0])) {
      await fetchOk(page, additionalImages[0], "image", 15000, { "user-agent": "Skroutz ImageBot v1" });
      const size = await getImageSize(page, additionalImages[0]);
      if (!size || (size.width <= 1000 && size.height <= 1000)) {
        warnings.push(`${label} 附加图片尺寸不足：${size?.width || 0}x${size?.height || 0}`);
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
    const response = await page.request.get(url("/feed.xml"), {
      timeout: 25000,
      headers: {
        "user-agent": "SkroutzBot v1.0",
        accept: "application/xml,application/gzip,text/csv,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-encoding": "gzip",
      },
    });
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
