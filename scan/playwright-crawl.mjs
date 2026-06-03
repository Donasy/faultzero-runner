import { chromium } from "playwright";

const TARGET_URL = process.env.TARGET_URL;
const RESULTS_DIR = process.env.RESULTS_DIR;

if (!TARGET_URL || !RESULTS_DIR) {
  console.error("[playwright] missing TARGET_URL or RESULTS_DIR");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: "FaultZero/1.0" });
const page = await context.newPage();

const consoleLogs = [];
page.on("console", (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));

const failedRequests = [];
page.on("requestfailed", (req) =>
  failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }),
);

const start = Date.now();
await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 });
const loadTimeMs = Date.now() - start;

const title = await page.title();
const htmlSize = (await page.content()).length;

const perf = JSON.parse(
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

await browser.close();

const output = {
  tool: "playwright",
  scan_id: process.env.SCAN_ID,
  target_url: TARGET_URL,
  results: {
    title,
    loadTimeMs,
    htmlSize,
    performance: perf,
    consoleLogs: consoleLogs.slice(0, 50),
    failedRequests: failedRequests.slice(0, 20),
    accessible: failedRequests.length === 0,
  },
};

const fs = await import("fs");
fs.writeFileSync(`${RESULTS_DIR}/playwright.json`, JSON.stringify(output, null, 2));

console.log(`[playwright] title="${title}" load=${loadTimeMs}ms errors=${failedRequests.length}`);
