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

const PATTERNS = {
  "Next.js": [{ header: "x-nextjs" }, { header: "x-powered-by", value: /next/i }, { html: /_next\/static/i }, { html: /__NEXT_DATA__/i }, { html: /next\.js/i }],
  "Nuxt.js": [{ header: "x-nuxt" }, { html: /__NUXT__/i }, { html: /nuxt\.js/i }],
  "Gatsby": [{ header: "x-gatsby" }, { html: /gatsby-/i }],
  "Astro": [{ header: "x-astro" }, { html: /astro-/i }],
  "Remix": [{ header: "x-remix" }, { html: /remix-/i }],
  "Angular": [{ html: /ng-version/i }, { html: /angular/i }],
  "Vue.js": [{ html: /vue\.js/i }, { html: /__VUE__/i }],
  "Svelte": [{ html: /svelte/i }],
  "Vite": [{ header: "x-powered-by", value: /vite/i }, { html: /\/assets\/index-[a-z0-9]+\.js/i }],
  "Express": [{ header: "x-powered-by", value: /express/i }],
  "PHP": [{ header: "x-powered-by", value: /php/i }, { html: /\.php/i }],
  "ASP.NET": [{ header: "x-aspnet-version" }, { header: "x-powered-by", value: /asp\.net/i }],
  "Django": [{ header: "x-django" }, { header: "x-powered-by", value: /django/i }],
  "Ruby on Rails": [{ header: "x-rails" }, { header: "x-powered-by", value: /rails/i }],
  "Spring Boot": [{ header: "x-application-context" }, { header: "x-powered-by", value: /spring/i }],
  "Laravel": [{ header: "x-powered-by", value: /laravel/i }],
  "WordPress": [{ html: /wp-content/i }, { html: /wp-includes/i }, { html: /<meta name="generator"[^>]*wordpress/i }],
  "Drupal": [{ html: /drupal/i }],
  "Joomla": [{ html: /joomla/i }],
  "Shopify": [{ header: "x-shopid" }, { header: "x-stores" }],
  "Magento": [{ header: "x-magento" }, { html: /mage\b/i }],
  "Wix": [{ header: "x-wix" }],
  "Squarespace": [{ header: "x-squarespace" }],
  "Webflow": [{ header: "x-webflow" }],
  "Cloudflare": [{ header: "server", value: /cloudflare/i }, { header: "cf-ray" }, { header: "cf-cache-status" }],
  "Akamai": [{ header: "server", value: /akamai/i }, { header: "x-akamai" }],
  "Fastly": [{ header: "server", value: /fastly/i }, { header: "x-fastly" }],
  "Netlify": [{ header: "server", value: /netlify/i }],
  "Vercel": [{ header: "x-vercel" }, { header: "server", value: /vercel/i }],
  "Nginx": [{ header: "server", value: /nginx/i }],
  "Apache": [{ header: "server", value: /apache/i }],
  "IIS": [{ header: "server", value: /iis/i }],
  "Caddy": [{ header: "server", value: /caddy/i }],
  "Node.js": [{ header: "x-powered-by", value: /node/i }],
  "Python": [{ header: "x-powered-by", value: /python/i }],
  "Ruby": [{ header: "x-powered-by", value: /ruby/i }],
  "Java": [{ header: "x-powered-by", value: /java|jdk/i }],
  "Go": [{ header: "x-powered-by", value: /go/i }],
  "React": [{ html: /react\.js/i }, { html: /react\.min\.js/i }, { html: /__REACT_DEVTOOLS/i }],
  "jQuery": [{ html: /jquery/i }],
  "Bootstrap": [{ html: /bootstrap/i }],
  "Tailwind CSS": [{ html: /tailwind/i }],
  "Google Analytics": [{ html: /gtag\s*\(/i }, { html: /google-analytics/i }, { html: /ga\.js/i }],
  "Google Tag Manager": [{ html: /googletagmanager/i }],
  "Facebook Pixel": [{ html: /fbq\s*\(/i }, { html: /connect\.facebook\.net/i }],
  "Hotjar": [{ html: /hotjar/i }],
  "Intercom": [{ html: /intercom/i }],
  "Stripe": [{ html: /js\.stripe\.com/i }, { html: /stripe\.js/i }],
  "Sentry": [{ html: /sentry\.js/i }, { html: /sentry\.io/i }],
  "Algolia": [{ html: /algolia/i }],
  "Mapbox": [{ html: /mapbox/i }],
  "Google Maps": [{ html: /maps\.googleapis\.com/i }],
  "YouTube": [{ html: /youtube\.com\/embed/i }, { html: /youtube\.com\/watch/i }],
  "Vimeo": [{ html: /player\.vimeo\.com/i }],
};

let technologies = [];
let output;

try {
  if (!TARGET_URL || !RESULTS_DIR) {
    throw new Error("missing TARGET_URL or RESULTS_DIR");
  }

  const res = await fetch(TARGET_URL, withProxy({
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  }));
  const html = await res.text();

  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  for (const [tech, rules] of Object.entries(PATTERNS)) {
    let detected = false;
    const evidence = [];
    for (const rule of rules) {
      if (rule.header) {
        const hv = headers[rule.header];
        if (hv) {
          if (rule.value) {
            if (rule.value.test(hv)) {
              evidence.push(`header[${rule.header}]=${hv}`);
              detected = true;
            }
          } else {
            evidence.push(`header[${rule.header}]=${hv}`);
            detected = true;
          }
        }
      }
      if (rule.html && rule.html.test(html)) {
        evidence.push("html pattern match");
        detected = true;
      }
    }
    if (detected) {
      technologies.push({ technology: tech, evidence });
    }
  }

  output = {
    tool: "tech-detect",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    technologies,
  };
} catch (err) {
  console.error(`[tech-detect] error: ${err.message}`);
  output = {
    tool: "tech-detect",
    scan_id: process.env.SCAN_ID,
    target_url: TARGET_URL,
    technologies: [],
  };
}

fs.writeFileSync(`${RESULTS_DIR}/tech.json`, JSON.stringify(output, null, 2));
console.log(`[tech-detect] done technologies=${output.technologies.length}`);
