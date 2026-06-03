import http from "k6/http";
import { check, sleep } from "k6";

const TARGET = __ENV.TARGET_URL;

export const options = {
  stages: [
    { duration: "10s", target: __ENV.VUS },
    { duration: "40s", target: __ENV.VUS },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.1"],
  },
};

export default function () {
  const res = http.get(TARGET);
  check(res, {
    "status is 2xx": (r) => r.status >= 200 && r.status < 300,
    "status is not 5xx": (r) => r.status < 500,
  });
  sleep(1);
}
