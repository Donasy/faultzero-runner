import { exec } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const RESULTS_DIR = process.env.RESULTS_DIR;
const TARGET_URL = process.env.TARGET_URL;

let proxies = ["direct"];
try {
  const raw = readFileSync(`${RESULTS_DIR}/proxies.json`, "utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed) && parsed.length > 0) proxies = parsed;
} catch {}

const totalVUs = parseInt(process.env.VUS, 10) || 10;
const vusPerProxy = Math.ceil(totalVUs / proxies.length);

console.log(`[k6-swarm] proxies=${proxies.length} totalVUs=${totalVUs} vusPerProxy=${vusPerProxy}`);

async function spawnK6(proxy, index) {
  await new Promise((r) => setTimeout(r, index * 2000));
  return new Promise((resolve) => {
    const outFile = `${RESULTS_DIR}/k6_${index}.json`;
    let cmd;
    if (proxy === "direct") {
      cmd = `k6 run --no-api --summary-export="${outFile}" -e TARGET_URL="${TARGET_URL}" -e VUS=${vusPerProxy} scripts/scan/load-test.js`;
    } else {
      cmd = `HTTP_PROXY=${proxy} HTTPS_PROXY=${proxy} k6 run --no-api --summary-export="${outFile}" -e TARGET_URL="${TARGET_URL}" -e VUS=${vusPerProxy} scripts/scan/load-test.js`;
    }

    console.log(`[k6-swarm] spawning #${index} proxy=${proxy} vus=${vusPerProxy}`);
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) console.warn(`[k6-swarm] #${index} error: ${err.message}`);
      if (stdout) console.log(`[k6-swarm] #${index} stdout: ${stdout.trim().split("\n").pop()}`);
      resolve(index);
    });
  });
}

const start = Date.now();
await Promise.all(proxies.map((p, i) => spawnK6(p, i)));
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[k6-swarm] all finished in ${elapsed}s, aggregating...`);

// Aggregate results
let totalCount = 0;
let rates = [];
let allDurations = { avg: [], min: [], med: [], max: [], "p(90)": [], "p(95)": [], "p(99)": [] };

for (let i = 0; i < proxies.length; i++) {
  const file = `${RESULTS_DIR}/k6_${i}.json`;
  if (!existsSync(file)) {
    console.warn(`[k6-swarm] ${file} not found`);
    continue;
  }
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    const m = data.metrics || {};
    if (m.http_reqs) totalCount += m.http_reqs.values?.count || 0;
    if (m.http_req_failed) rates.push(m.http_req_failed.values?.rate || 0);
    if (m.http_req_duration) {
      for (const key of Object.keys(allDurations)) {
        if (m.http_req_duration.values?.[key] !== undefined) {
          allDurations[key].push(m.http_req_duration.values[key]);
        }
      }
    }
  } catch (e) {
    console.warn(`[k6-swarm] failed to parse ${file}: ${e.message}`);
  }
}

const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const aggregated = {
  metrics: {
    http_reqs: {
      type: "counter",
      contains: "default",
      values: { count: totalCount, rate: totalCount / elapsed },
    },
    http_req_failed: {
      type: "rate",
      contains: "default",
      values: { rate: avg(rates) },
    },
    http_req_duration: {
      type: "trend",
      contains: "time",
      values: Object.fromEntries(
        Object.entries(allDurations).map(([k, v]) => [k, v.length ? (k === "min" ? Math.min(...v) : k === "max" ? Math.max(...v) : avg(v)) : 0]),
      ),
    },
  },
};

writeFileSync(`${RESULTS_DIR}/k6.json`, JSON.stringify(aggregated, null, 2));
console.log(`[k6-swarm] done totalReqs=${totalCount} avgFailRate=${avg(rates).toFixed(4)}`);
