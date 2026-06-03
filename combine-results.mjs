import { readFileSync, existsSync } from "fs";

const RESULTS_DIR = process.env.RESULTS_DIR || ".";
const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

function readJSON(path) {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch (e) {
    console.error(`[combine] failed to read ${path}: ${e.message}`);
  }
  return null;
}

const playwright = readJSON(`${RESULTS_DIR}/playwright.json`);
const k6 = readJSON(`${RESULTS_DIR}/k6-summary.json`);
const zap = readJSON(`${RESULTS_DIR}/zap-report.json`);

const report = {
  scan_id: process.env.SCAN_ID,
  target_url: process.env.TARGET_URL,
  vus: Number(process.env.VUS),
  completed_at: new Date().toISOString(),
  results: {
    playwright: playwright?.results || null,
    k6: k6
      ? {
          metrics: {
            http_req_duration: k6.metrics?.http_req_duration,
            http_req_failed: k6.metrics?.http_req_failed,
          },
          vus_max: k6.metrics?.vus_max,
        }
      : null,
    zap: zap
      ? {
          alerts: zap.site?.[0]?.alerts?.length || 0,
          high: zap.site?.[0]?.alerts?.filter((a) => a.risk === "High").length || 0,
          medium: zap.site?.[0]?.alerts?.filter((a) => a.risk === "Medium").length || 0,
          low: zap.site?.[0]?.alerts?.filter((a) => a.risk === "Low").length || 0,
        }
      : null,
  },
  raw: {
    playwright,
    k6,
    zap,
  },
};

const jsonPath = `${RESULTS_DIR}/combined-report.json`;
import { writeFileSync } from "fs";
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(`[combine] report written to ${jsonPath}`);

// Send to n8n webhook
if (WEBHOOK_URL) {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });

    if (res.ok || res.status === 204) {
      console.log("[combine] webhook delivered to n8n");
    } else {
      const body = await res.text().catch(() => "");
      console.error(`[combine] webhook failed status=${res.status} body=${body}`);
    }
  } catch (err) {
    console.error(`[combine] webhook error: ${err.message}`);
  }
} else {
  console.warn("[combine] N8N_WEBHOOK_URL not set — skipping webhook");
}
