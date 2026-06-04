import http from "k6/http";
import { check, sleep } from "k6";

const targetUrl = __ENV.TARGET_URL;
const vuCount = parseInt(__ENV.VUS, 10) || 10;

export const options = {
  vus: vuCount,
  duration: "10s",
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.1"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export default function () {
  const res = http.get(targetUrl);
  check(res, {
    "status is 2xx or 3xx": (r) => r.status >= 200 && r.status < 400,
    "response time < 5s": (r) => r.timings.duration < 5000,
  });
  sleep(0.5);
}
