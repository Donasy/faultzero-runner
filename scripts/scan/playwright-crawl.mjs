import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const TARGET_URL = process.env.TARGET_URL;
const RESULTS_DIR = process.env.RESULTS_DIR;
const fs = await import("fs");
const start = Date.now();

let proxies = ["direct"];
try {
  const raw = fs.readFileSync(`${RESULTS_DIR}/proxies.json`, "utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed) && parsed.length > 0) proxies = parsed;
} catch {}

let output;
let browser;
let succeeded = false;

for (const proxyEntry of proxies) {
  if (succeeded) break;

  const proxyServer = proxyEntry === "direct" ? "" : proxyEntry;
  browser = undefined;

  try {
    if (!TARGET_URL || !RESULTS_DIR) {
      throw new Error("missing TARGET_URL or RESULTS_DIR");
    }

    const launchOpts = {
      headless: true,
      args: ["--ignore-certificate-errors", "--no-sandbox"],
    };
    if (proxyServer) launchOpts.proxy = { server: proxyServer };

    console.log(`[playwright] trying proxy: ${proxyServer || "direct"}`);
    browser = await chromium.launch(launchOpts);

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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
    const blocked = title?.toLowerCase().includes("checking your browser");

    if (blocked) {
      console.log(`[playwright] proxy ${proxyServer || "direct"} blocked by WAF, trying next...`);
      continue;
    }

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
      proxyUsed: proxyServer || "direct",
      results: {
        title,
        loadTimeMs: Date.now() - start,
        htmlSize,
        performance: perf,
        consoleLogs: consoleLogs.slice(0, 50),
        failedRequests: failedRequests.slice(0, 20),
        accessible: failedRequests.length === 0,
        blocked: false,
      },
    };
    succeeded = true;
  } catch (err) {
    console.error(`[playwright] proxy ${proxyServer || "direct"} error: ${err.message}`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

if (!succeeded) {
  console.error("[playwright] all proxies failed");
  output = {
    tool: "playwright",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    proxyUsed: proxies.join(","),
    results: {
      title: "",
      loadTimeMs: Date.now() - start,
      htmlSize: 0,
      performance: { ttfb: 0, domContentLoaded: 0, loadComplete: 0 },
      consoleLogs: [],
      failedRequests: [],
      accessible: false,
      blocked: true,
      error: "all proxies failed or were blocked",
    },
  };
}

fs.writeFileSync(`${RESULTS_DIR}/playwright.json`, JSON.stringify(output, null, 2));
console.log(`[playwright] done blocked=${output.results.blocked} succeeded=${succeeded}`);
