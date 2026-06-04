const TARGET_URL = process.env.TARGET_URL;
const RESULTS_DIR = process.env.RESULTS_DIR;
const fs = await import("fs");

let proxyDispatcher;
try {
  const raw = fs.readFileSync(`${RESULTS_DIR}/proxies.json`, "utf-8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] !== "direct") {
    const { ProxyAgent } = await import("undici");
    proxyDispatcher = new ProxyAgent(parsed[0]);
  }
} catch {}

const withProxy = (opts) => proxyDispatcher ? { ...opts, dispatcher: proxyDispatcher } : opts;

const SECRET_PATTERNS = [
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z_-]{35}/g, severity: "high" },
  { name: "Stripe Live Secret", pattern: /sk_live_[0-9a-zA-Z]{24,}/g, severity: "critical" },
  { name: "Stripe Publishable Key", pattern: /pk_live_[0-9a-zA-Z]{24,}/g, severity: "medium" },
  { name: "Stripe Test Secret", pattern: /sk_test_[0-9a-zA-Z]{24,}/g, severity: "medium" },
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  { name: "AWS Secret Key", pattern: /(?<![a-zA-Z0-9])[A-Za-z0-9/+=]{40}(?![a-zA-Z0-9])/g, severity: "critical" },
  { name: "GitHub PAT", pattern: /ghp_[0-9a-zA-Z]{36}/g, severity: "critical" },
  { name: "GitHub Fine-Grained PAT", pattern: /github_pat_[0-9a-zA-Z_]{82}/g, severity: "critical" },
  { name: "Slack Bot Token", pattern: /xoxb-[0-9a-zA-Z-]{24,}/g, severity: "high" },
  { name: "Slack App Token", pattern: /xapp-[0-9a-zA-Z-]{24,}/g, severity: "high" },
  { name: "Generic Bearer Token", pattern: /bearer\s+[A-Za-z0-9_\-\.]{20,}/gi, severity: "high" },
  { name: "Generic API Key Assignment", pattern: /api[_-]?key\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']/gi, severity: "high" },
  { name: "Generic Secret Assignment", pattern: /secret\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']/gi, severity: "high" },
  { name: "Firebase URL", pattern: /https?:\/\/[a-zA-Z0-9-]+\.firebaseio\.com/g, severity: "medium" },
  { name: "SendGrid API Key", pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, severity: "high" },
  { name: "Mailgun API Key", pattern: /key-[0-9a-fA-F]{32}/g, severity: "high" },
  { name: "Twilio SID", pattern: /SK[0-9a-fA-F]{32}/g, severity: "high" },
  { name: "Private Key (RSA)", pattern: /-----BEGIN\s(RSA\s)?PRIVATE\sKEY-----/g, severity: "critical" },
  { name: "MongoDB Connection String", pattern: /mongodb(?:\+srv)?:\/\/[^\s<>"']+/g, severity: "critical" },
  { name: "PostgreSQL Connection String", pattern: /postgres(?:ql)?:\/\/[^\s<>"']+/g, severity: "critical" },
  { name: "JWT Secret", pattern: /jwt[_-]?secret\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']/gi, severity: "high" },
  { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: "medium" },
  { name: "npm Token", pattern: /npm_[A-Za-z0-9]{36}/g, severity: "high" },
  { name: "Heroku API Key", pattern: /[hH][eE][rR][oO][kK][uU]\s*[:=]\s*["\'][A-Za-z0-9-]{36}["\']/g, severity: "high" },
  { name: "Docker Hub PAT", pattern: /dckr_pat_[A-Za-z0-9_-]{26,}/g, severity: "high" },
  { name: "Generic Password in Code", pattern: /password\s*[:=]\s*["\'][A-Za-z0-9!@#$%^&*()_+]{8,}["\']/gi, severity: "high" },
  { name: "Hardcoded AWS Region", pattern: /region\s*[:=]\s*["\'](us-east-1|us-west-2|eu-west-1|ap-southeast-1)["\']/gi, severity: "low" },
];

const JS_SCRIPT_RE = /<script[^>]+src\s*=\s*["']([^"']+\.js[^"']*)["']/gi;

let output;
let findings = [];

try {
  if (!TARGET_URL || !RESULTS_DIR) {
    throw new Error("missing TARGET_URL or RESULTS_DIR");
  }

  // 1. Fetch HTML
  const htmlRes = await fetch(TARGET_URL, withProxy({
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  }));
  const html = await htmlRes.text();

  // 2. Parse script tags for JS bundle URLs
  const scriptSrcs = [];
  let match;
  while ((match = JS_SCRIPT_RE.exec(html)) !== null) {
    let src = match[1];
    if (src.startsWith("//")) {
      src = new URL(TARGET_URL).protocol + src;
    } else if (src.startsWith("/")) {
      src = `${new URL(TARGET_URL).origin}${src}`;
    } else if (!src.startsWith("http")) {
      src = `${new URL(TARGET_URL).origin}/${src}`;
    }
    scriptSrcs.push(src);
  }

  console.log(`[secrets] found ${scriptSrcs.length} JS bundle(s)`);

  // 3. Fetch each JS file and scan for secrets
  const seen = new Set();
  for (const jsUrl of scriptSrcs) {
    try {
      const jsRes = await fetch(jsUrl, withProxy({
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      }));
      const jsContent = await jsRes.text();

      for (const { name, pattern, severity } of SECRET_PATTERNS) {
        const matches = jsContent.match(pattern);
        if (matches) {
          for (const value of matches) {
            const key = `${name}::${value.slice(0, 20)}`;
            if (seen.has(key)) continue;
            seen.add(key);

            findings.push({
              severity,
              type: name,
              source: jsUrl,
              value: value.length > 40 ? `${value.slice(0, 20)}...${value.slice(-10)}` : value,
              snippet: extractSnippet(jsContent, value),
            });
          }
        }
      }
    } catch {
      console.warn(`[secrets] failed to fetch ${jsUrl}`);
    }
  }

  output = {
    tool: "secret-scan",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    results: {
      bundlesScanned: scriptSrcs.length,
      totalFindings: findings.length,
      findings,
    },
  };
} catch (err) {
  console.error(`[secrets] error: ${err.message}`);
  output = {
    tool: "secret-scan",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    results: {
      bundlesScanned: 0,
      totalFindings: 0,
      findings: [{ severity: "high", type: "scan-error", detail: err.message }],
    },
  };
}

function extractSnippet(content, value) {
  const idx = content.indexOf(value);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + value.length + 40);
  return content.slice(start, end).replace(/\n/g, " ");
}

fs.writeFileSync(`${RESULTS_DIR}/secrets.json`, JSON.stringify(output, null, 2));
console.log(`[secrets] done findings=${findings.length}`);
