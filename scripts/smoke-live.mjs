// Live smoke test: runs the real pipeline in Google Chrome and prints the step summary + trace.
// Usage: node scripts/smoke-live.mjs [url] [screenshot.png]
//   default url: http://localhost:3000/analyze?demo=pullup&live=1
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3000/analyze?demo=pullup&live=1";
const shot = process.argv[3];
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("response", (r) => {
  if (r.url().includes("/api/")) console.log(`API ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`);
});

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page
  .waitForSelector('[data-testid="step-verify"][data-status="done"], [data-testid="step-verify"][data-status="fallback"], [data-testid="step-verify"][data-status="skipped"], [data-stage="error"]', { timeout: 240_000 })
  .catch(() => console.log("TIMEOUT waiting for pipeline"));
console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

const steps = await page.$$eval('[data-testid^="step-"]', (els) =>
  els.map((e) => `${e.getAttribute("data-testid")?.padEnd(13)} ${e.getAttribute("data-status")?.padEnd(9)} ${e.textContent?.replace(/\s+/g, " ").trim().slice(0, 110)}`),
);
console.log(steps.join("\n"));
for (const id of ["found-banner", "coach-text", "form-score"]) {
  const t = await page.locator(`[data-testid="${id}"]`).first().textContent().catch(() => null);
  console.log(`\n${id}: ${t?.replace(/\s+/g, " ").trim().slice(0, 400)}`);
}
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();
