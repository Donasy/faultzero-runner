const RESULTS_DIR = process.env.RESULTS_DIR;
const fs = await import("fs");

const PROXY_TARGET = "https://httpbin.org/ip";
const TIMEOUT_MS = 3000;

async function fetchProxyList() {
  const urls = [
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all",
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const text = await res.text();
      const proxies = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (proxies.length > 0) return proxies;
    } catch {
      continue;
    }
  }
  return [];
}

async function testProxy(proxy) {
  try {
    const proxyUrl = `http://${proxy}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(PROXY_TARGET, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    clearTimeout(timer);
    if (!res.ok) return null;
    const body = await res.json();
    return body?.origin ? proxyUrl : null;
  } catch {
    return null;
  }
}

let proxies = ["direct"];

try {
  if (!RESULTS_DIR) throw new Error("missing RESULTS_DIR");

  console.log("[proxy-manager] fetching proxy list...");
  const allProxies = await fetchProxyList();
  console.log(`[proxy-manager] got ${allProxies.length} proxies`);

  const candidates = allProxies.slice(0, 20);
  console.log(`[proxy-manager] testing ${candidates.length} proxies...`);

  const results = await Promise.allSettled(candidates.map(testProxy));
  const working = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value)
    .slice(0, 5);

  if (working.length > 0) {
    proxies = working;
    console.log(`[proxy-manager] ${working.length} working proxy(-ies): ${proxies.join(", ")}`);
  } else {
    console.log("[proxy-manager] no working proxy found, using direct");
  }
} catch (err) {
  console.error(`[proxy-manager] error: ${err.message}`);
}

fs.writeFileSync(`${RESULTS_DIR}/proxies.json`, JSON.stringify(proxies, null, 2));
console.log(`[proxy-manager] saved proxies.json: ${proxies.length} proxy(-ies)`);
