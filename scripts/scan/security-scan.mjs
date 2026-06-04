const TARGET_URL = process.env.TARGET_URL;
const RESULTS_DIR = process.env.RESULTS_DIR;
const fs = await import("fs");

const SENSITIVE_PATHS = [
  "/.env", "/.env.local", "/.env.production", "/.git/config",
  "/admin", "/config.json", "/wp-config.php", "/.htaccess",
  "/robots.txt", "/sitemap.xml", "/crossdomain.xml",
  "/api/swagger.json", "/api/docs", "/.well-known/security.txt",
];

const SECURITY_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "x-xss-protection",
  "content-security-policy",
  "referrer-policy",
  "permissions-policy",
  "access-control-allow-origin",
];

let findings = [];
let output;

try {
  if (!TARGET_URL || !RESULTS_DIR) {
    throw new Error("missing TARGET_URL or RESULTS_DIR");
  }

  const url = new URL(TARGET_URL);
  const baseOrigin = url.origin;

  // 1. Check security headers
  const res = await fetch(TARGET_URL, {
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  const presentHeaders = [];
  const missingHeaders = [];
  for (const h of SECURITY_HEADERS) {
    if (headers[h]) {
      presentHeaders.push({ header: h, value: headers[h] });
    } else {
      missingHeaders.push(h);
    }
  }

  if (missingHeaders.length > 0) {
    findings.push({
      severity: "medium",
      category: "missing-security-header",
      detail: `${missingHeaders.length} security headers missing: ${missingHeaders.join(", ")}`,
      headers: missingHeaders,
    });
  }

  // 2. Check HTTPS
  if (url.protocol !== "https:") {
    findings.push({
      severity: "high",
      category: "no-https",
      detail: "Target does not use HTTPS",
    });
  }

  // 3. Check server info disclosure
  if (headers["server"]) {
    findings.push({
      severity: "low",
      category: "server-info-disclosure",
      detail: `Server header exposes: ${headers["server"]}`,
    });
  }

  if (headers["x-powered-by"]) {
    findings.push({
      severity: "low",
      category: "x-powered-by-disclosure",
      detail: `X-Powered-By header exposes: ${headers["x-powered-by"]}`,
    });
  }

  // 4. Probe sensitive paths
  const probeResults = [];
  for (const path of SENSITIVE_PATHS) {
    try {
      const probeUrl = `${baseOrigin}${path}`;
      const probeRes = await fetch(probeUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
      if (probeRes.status === 200) {
        probeResults.push({ path, status: 200, size: (await probeRes.clone().text()).length });
      } else if (probeRes.status === 301 || probeRes.status === 302 || probeRes.status === 303 || probeRes.status === 307 || probeRes.status === 308) {
        probeResults.push({ path, status: probeRes.status, redirect: probeRes.headers.get("location") });
      }
    } catch {
      // timeout or network error — skip
    }
  }

  const accessiblePaths = probeResults.filter((p) => p.status === 200);
  if (accessiblePaths.length > 0) {
    findings.push({
      severity: accessiblePaths.some((p) => p.path.includes(".env") || p.path.includes(".git"))
        ? "critical"
        : "medium",
      category: "exposed-sensitive-path",
      detail: `${accessiblePaths.length} sensitive path(s) accessible: ${accessiblePaths.map((p) => `${p.path} (${p.status})`).join(", ")}`,
      paths: accessiblePaths,
    });
  }

  // 5. Check redirects
  if (res.redirected) {
    findings.push({
      severity: "info",
      category: "redirect-chain",
      detail: `Final destination after redirect: ${res.url}`,
      finalUrl: res.url,
    });
  }

  output = {
    tool: "security-scan",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    results: {
      url: TARGET_URL,
      statusCode: res.status,
      secure: url.protocol === "https:",
      presentHeaders,
      probeResults,
      findings,
    },
  };
} catch (err) {
  console.error(`[security] error: ${err.message}`);
  output = {
    tool: "security-scan",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    results: {
      url: TARGET_URL,
      statusCode: 0,
      secure: false,
      presentHeaders: [],
      probeResults: [],
      findings: [{ severity: "high", category: "scan-error", detail: err.message }],
    },
  };
}

fs.writeFileSync(`${RESULTS_DIR}/security.json`, JSON.stringify(output, null, 2));
console.log(`[security] done findings=${output.results.findings.length}`);
