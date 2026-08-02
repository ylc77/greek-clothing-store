/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    [
      "Playwright is not installed.",
      "Install it first:",
      "  npm install -D playwright",
      "  npx playwright install chromium",
    ].join("\n"),
  );
  process.exit(1);
}

const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

if (!BASE_URL) {
  console.error("Missing BASE_URL. Example: BASE_URL=http://localhost:3000 node scripts/demo-record.js");
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error("Missing ADMIN_PASSWORD. Example: ADMIN_PASSWORD=your-admin-password node scripts/demo-record.js");
  process.exit(1);
}

const outputDir = path.join(process.cwd(), "demo-videos");
const debugDir = path.join(outputDir, "debug");
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(debugDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

function fullUrl(route) {
  if (/^https?:\/\//.test(route)) return route;
  return `${BASE_URL}${route.startsWith("/") ? route : `/${route}`}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStyledPage(page, route) {
  if (route.includes("feed.xml")) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const styled = await page
      .waitForFunction(
        () => {
          const font = getComputedStyle(document.body).fontFamily;
          return document.styleSheets.length > 0 && !/Times New Roman/i.test(font);
        },
        null,
        { timeout: 6000 },
      )
      .then(() => true)
      .catch(() => false);

    if (styled) return;
    if (attempt === 0) {
      await page.reload({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await delay(1200);
    }
  }

  console.warn(`Styles did not finish loading for ${route}. Continuing recording.`);
}

async function addSubtitle(page, text) {
  await page.evaluate((subtitle) => {
    const styleId = "codex-demo-subtitle-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #codex-demo-subtitle {
          position: fixed;
          left: 50%;
          bottom: 34px;
          transform: translateX(-50%);
          z-index: 2147483647;
          max-width: min(920px, calc(100vw - 80px));
          padding: 10px 18px;
          border-radius: 999px;
          background: rgba(17, 24, 39, 0.82);
          color: #fff;
          font: 600 22px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
          text-align: center;
          box-shadow: 0 16px 44px rgba(0, 0, 0, 0.22);
          pointer-events: none;
          letter-spacing: 0;
        }
      `;
      document.head.appendChild(style);
    }

    let el = document.getElementById("codex-demo-subtitle");
    if (!el) {
      el = document.createElement("div");
      el.id = "codex-demo-subtitle";
      document.body.appendChild(el);
    }
    el.textContent = subtitle;
  }, text);
}

async function gotoPage(page, route) {
  await page.goto(fullUrl(route), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await waitForStyledPage(page, route);
}

async function safeScreenshot(page, name) {
  const file = path.join(debugDir, `${timestamp}-${name.replace(/[^a-z0-9-_]+/gi, "-")}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  console.warn(`Saved debug screenshot: ${file}`);
}

async function scene(page, name, subtitle, action, holdMs = 2600) {
  console.log(`Scene: ${name}`);
  try {
    await addSubtitle(page, subtitle);
    await action();
  } catch (error) {
    console.warn(`Scene failed: ${name}`);
    console.warn(error instanceof Error ? error.message : String(error));
    await safeScreenshot(page, name);
  }
  await delay(holdMs);
}

async function scrollBy(page, amount, steps = 5) {
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, amount / steps);
    await delay(350);
  }
}

async function clickFirstVisible(locator, label) {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      return true;
    }
  }
  throw new Error(`Could not find visible element: ${label}`);
}

async function clickByText(page, pattern, label) {
  const locator = page.getByText(pattern).first();
  if (await locator.isVisible().catch(() => false)) {
    await locator.click();
    return true;
  }
  throw new Error(`Could not click text: ${label}`);
}

async function askAiQuestion(page, question) {
  await clickFirstVisible(page.locator('button[aria-label="AI Assistant"], button:has-text("AI")'), "AI assistant");
  await delay(1200);

  const fields = page.locator('input:not([type="hidden"]):not([type="password"]), textarea');
  const count = await fields.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const field = fields.nth(i);
    if (await field.isVisible().catch(() => false)) {
      await field.fill(question);
      await field.press("Enter");
      await delay(5000);
      return;
    }
  }

  const quickButton = page.locator("button").filter({ hasText: /Size|size|Μέγεθος|尺码/i }).first();
  if (await quickButton.isVisible().catch(() => false)) {
    await quickButton.click();
    await delay(5000);
    return;
  }

  throw new Error("AI assistant opened, but no chat input or quick question was visible.");
}

async function submitVisiblePassword(page) {
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(ADMIN_PASSWORD);
    await page.evaluate((password) => {
      const input = document.querySelector('input[type="password"]');
      if (!input) return;

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, password);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const form = input.closest("form");
      if (form && typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }, ADMIN_PASSWORD);

    await delay(1200);
    if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
      const loginButton = passwordInput.locator("xpath=ancestor::form[1]//button").first();
      if (await loginButton.isVisible().catch(() => false)) {
        await loginButton.click();
      } else {
        await passwordInput.press("Enter");
      }
    }
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await delay(1200);
  }

  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    throw new Error("Admin login did not complete. Check ADMIN_PASSWORD and BASE_URL.");
  }
}

async function loginAdminIfNeeded(page) {
  await gotoPage(page, "/admin");
  await submitVisiblePassword(page);
}

async function openAdminTab(page, labelPattern, label) {
  await loginAdminIfNeeded(page);
  const buttons = page.locator("nav button");
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const text = (await button.textContent().catch(() => "")) || "";
    if (labelPattern.test(text)) {
      await button.click();
      await delay(1000);
      return;
    }
  }
  throw new Error(`Could not open admin tab: ${label}`);
}

async function main() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === "0" ? false : true,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: outputDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  let productUrl = "/product/TEST-MULTI-001";

  await scene(page, "home-hero", "一个专为服装店打造的商品展示网站", async () => {
    await gotoPage(page, "/");
  });

  await scene(page, "home-scroll", "首页展示品牌形象、分类入口和最新商品", async () => {
    await scrollBy(page, 820, 6);
  });

  await scene(page, "category-list", "分类页支持男装、女装、鞋包配饰和二级筛选", async () => {
    await gotoPage(page, "/women");
    await scrollBy(page, 260, 2);
  });

  await scene(page, "product-detail", "商品详情页展示多图、价格、尺码、库存和咨询入口", async () => {
    const firstProduct = page.locator('a[href*="/product/"]').first();
    if (await firstProduct.isVisible().catch(() => false)) {
      const href = await firstProduct.getAttribute("href");
      if (href) productUrl = href;
      await firstProduct.click();
    } else {
      await gotoPage(page, productUrl);
    }
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await waitForStyledPage(page, productUrl);
  }, 3200);

  await scene(page, "ai-chat", "AI 客服可以根据身高体重给出尺码建议", async () => {
    await askAiQuestion(page, "I am 170cm and 65kg, what size should I choose?");
  }, 3500);

  await scene(page, "admin-login", "后台用密码保护，店主可以安全管理商品", async () => {
    await loginAdminIfNeeded(page);
  });

  await scene(page, "admin-products", "商品管理列表集中查看上架状态、库存和图片", async () => {
    await loginAdminIfNeeded(page);
    await scrollBy(page, 420, 3);
  });

  await scene(page, "admin-edit", "编辑商品时可以维护价格、分类、多语言内容和尺码库存", async () => {
    await loginAdminIfNeeded(page);
    await clickByText(page, /编辑|Edit/i, "edit product");
    await delay(1500);
    await scrollBy(page, 580, 4);
  }, 3200);

  await scene(page, "admin-images", "图片上传支持主图和多图，适合展示正面、背面和细节", async () => {
    await scrollBy(page, 680, 4);
  }, 3200);

  await scene(page, "admin-csv", "CSV 导入导出让批量维护商品更高效", async () => {
    await openAdminTab(page, /CSV/i, "CSV tab");
  });

  await scene(page, "store-settings", "店铺设置可以维护 Logo、首页图、WhatsApp 和 Instagram", async () => {
    await gotoPage(page, "/admin/settings");
    await submitVisiblePassword(page);
    await scrollBy(page, 420, 3);
  });

  await scene(page, "online-shopping", "顾客可以使用购物车，并选择货到付款或到店自取", async () => {
    await gotoPage(page, "/cart");
  }, 3000);

  await scene(page, "ending", "在线商店 · 后台管理 · 库存 · AI 客服", async () => {
    await page.goto("about:blank");
    await page.setContent(`
      <html>
        <head>
          <style>
            body {
              margin: 0;
              width: 100vw;
              height: 100vh;
              display: grid;
              place-items: center;
              background: #111827;
              color: white;
              font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            }
            .wrap { text-align: center; }
            h1 { font-size: 64px; margin: 0 0 24px; }
            p { font-size: 34px; margin: 0; color: #e5e7eb; }
          </style>
        </head>
        <body>
          <div class="wrap">
            <h1>服装店数字化展示系统</h1>
            <p>在线商店 · 后台管理 · 库存 · AI 客服</p>
          </div>
        </body>
      </html>
    `);
    await addSubtitle(page, "让商品展示、在线下单、客户咨询和库存管理更简单");
  }, 4200);

  await context.close();
  await browser.close();

  const videos = fs
    .readdirSync(outputDir)
    .filter((name) => name.endsWith(".webm"))
    .map((name) => path.join(outputDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (videos[0]) {
    const finalPath = path.join(outputDir, `greek-clothing-store-demo-${timestamp}.webm`);
    fs.renameSync(videos[0], finalPath);
    console.log(`Video saved: ${finalPath}`);
  } else {
    console.warn("Recording finished, but no .webm file was found.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
