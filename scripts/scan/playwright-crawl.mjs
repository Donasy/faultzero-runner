import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const TARGET_URL = process.env.TARGET_URL;
const RESULTS_DIR = process.env.RESULTS_DIR;
const fs = await import("fs");
const start = Date.now();

let browser;
let output;

try {
  if (!TARGET_URL || !RESULTS_DIR) {
    throw new Error("missing TARGET_URL or RESULTS_DIR");
  }

  browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors", "--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  const consoleLogs = [];
  page.on("console", (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));

  const failedRequests = [];
  page.on("requestfailed", (req) =>
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }),
  );

  await page.goto(TARGET_URL, { timeout: 15000, waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const title = await page.title();
  const htmlSize = (await page.content()).length;

  let perf = { ttfb: 0, domContentLoaded: 0, loadComplete: 0 };
  try {
    perf = JSON.parse(
      await page.evaluate(() =>
        JSON.stringify({
          ttfb: performance.getEntriesByType("navigation")[0]?.responseStart || 0,
          domContentLoaded:
            performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd || 0,
          loadComplete:
            performance.getEntriesByType("navigation")[0]?.loadEventEnd || 0,
        }),
      ),
    );
  } catch {}

  output = {
    tool: "playwright",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    results: {
      title,
      loadTimeMs: Date.now() - start,
      htmlSize,
      performance: perf,
      consoleLogs: consoleLogs.slice(0, 50),
      failedRequests: failedRequests.slice(0, 20),
      accessible: failedRequests.length === 0,
      blocked: title?.toLowerCase().includes("checking your browser"),
    },
  };
} catch (err) {
  console.error(`[playwright] error: ${err.message}`);
  output = {
    tool: "playwright",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    results: {
      title: "",
      loadTimeMs: Date.now() - start,
      htmlSize: 0,
      performance: { ttfb: 0, domContentLoaded: 0, loadComplete: 0 },
      consoleLogs: [],
      failedRequests: [],
      accessible: false,
      blocked: true,
      error: err.message,
    },
  };
} finally {
  if (browser) {
    try { await browser.close(); } catch {}
  }
}

fs.writeFileSync(`${RESULTS_DIR}/playwright.json`, JSON.stringify(output, null, 2));
console.log(`[playwright] done blocked=${output.results.blocked}`);
