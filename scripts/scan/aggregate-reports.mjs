import { readFileSync, writeFileSync, existsSync } from "fs";

const RESULTS_DIR = process.env.RESULTS_DIR;
if (!RESULTS_DIR) {
  console.error("[aggregate] missing RESULTS_DIR");
  process.exit(1);
}

function safeRead(filePath) {
  if (!existsSync(filePath)) {
    console.warn(`[aggregate] ${filePath} not found`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.warn(`[aggregate] failed to parse ${filePath}: ${err.message}`);
    return null;
  }
}

const playwrightData = safeRead(`${RESULTS_DIR}/playwright.json`);
const securityData = safeRead(`${RESULTS_DIR}/security.json`);
const secretsData = safeRead(`${RESULTS_DIR}/secrets.json`);
const k6Data = safeRead(`${RESULTS_DIR}/k6.json`);
const techData = safeRead(`${RESULTS_DIR}/tech.json`);

const finalReport = {
  scan_id: process.env.SCAN_ID,
  target_url: process.env.TARGET_URL,
  aggregated_at: new Date().toISOString(),
  playwright: playwrightData,
  security: securityData,
  secrets: secretsData,
  performance: k6Data,
  techStack: techData,
};

writeFileSync(`${RESULTS_DIR}/final_report.json`, JSON.stringify(finalReport, null, 2));
console.log(`[aggregate] done playwright=${!!playwrightData} security=${!!securityData} secrets=${!!secretsData} performance=${!!k6Data} techStack=${!!techData}`);
