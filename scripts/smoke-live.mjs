// Live smoke test: runs the real pipeline in Google Chrome and prints the detected exercise, steps and results.
// Usage: node scripts/smoke-live.mjs [url] [screenshot.png] [--upload=path/to/clip.mp4] [--ai-photo]
//   default url: http://localhost:3000/analyze?demo=pullup&live=1
//   --upload: open [url] (the landing page) and upload the clip with the "Auto" exercise chip
//   --ai-photo: after the results, click "Generate AI photo of the fix" and wait for done / failed
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.slice(2).split("="); return [k, v]; }));
const [url = "http://localhost:3000/analyze?demo=pullup&live=1", shot] = args.filter((a) => !a.startsWith("--"));
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("PAGEERROR", e.message);
});
page.on("response", (r) => {
  if (r.url().includes("/api/")) console.log(`API ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`);
});

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded" });
if (flags.upload) {
  await page.getByTestId("exercise-chip-auto").click();
  await page.getByTestId("dropzone-input").setInputFiles(flags.upload);
  await page.waitForURL(/\/analyze/);
  const src = await page.locator('[data-testid="analyzing-screen"] video').first().evaluate((v) => v.currentSrc || v.src).catch(() => "?");
  console.log(`analyzing-screen video src: ${src.slice(0, 40)}`);
}
await page
  .waitForSelector('[data-testid="results-screen"], [data-stage="error"]', { timeout: 300_000 })
  .catch(() => console.log("TIMEOUT waiting for pipeline"));
console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(1)} s · stage=${await page.locator("[data-stage]").first().getAttribute("data-stage")}\n`);

const text = async (sel) => (await page.locator(sel).first().textContent().catch(() => null))?.replace(/\s+/g, " ").trim() ?? null;
console.log(`detected: ${await text('[data-testid="exercise-badge"]')}`);
console.log(`detected (title): ${await page.locator('[data-testid="exercise-badge"]').first().getAttribute("title").catch(() => null)}`);
const steps = await page.$$eval('[data-testid^="step-"]', (els) =>
  els.map((e) => `${e.getAttribute("data-testid")?.padEnd(13)} ${e.getAttribute("data-status")?.padEnd(9)} ${e.textContent?.replace(/\s+/g, " ").trim().slice(0, 110)}`),
);
console.log(steps.join("\n"));
for (const id of ["found-banner", "form-score", "coach-text"]) console.log(`\n${id}: ${(await text(`[data-testid="${id}"]`))?.slice(0, 600)}`);
const angles = await page.$$eval('[data-testid="angle-card"]', (els) => els.map((e) => e.textContent?.replace(/\s+/g, " ").trim().slice(0, 160)));
console.log(`\nangles:\n  ${angles.join("\n  ")}`);
if (shot) await page.screenshot({ path: shot, fullPage: true });

if (flags.trace) {
  await page.getByTestId("trace-btn").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 10_000 }).catch(() => undefined);
  console.log(`\nagent trace:\n${((await dialog.innerText().catch(() => "")) || "").slice(0, Number(flags.trace) > 1 ? Number(flags.trace) : 2500)}`);
  await page.keyboard.press("Escape");
}

if (flags["ai-photo"]) {
  const t1 = Date.now();
  await page.getByTestId("ai-photo-btn").first().click();
  await page
    .waitForSelector('[data-testid="ai-photo-btn"][data-state="done"], [data-testid="ai-photo-btn"][data-state="failed"]', { timeout: 180_000 })
    .catch(() => console.log("TIMEOUT waiting for the AI photo"));
  const state = await page.getByTestId("ai-photo-btn").first().getAttribute("data-state");
  console.log(`\nAI photo: ${state} in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  const panel = await text('[data-testid="ai-photo-btn"] >> xpath=ancestor::div[contains(@class,"@container")][1]');
  console.log(`AI photo panel: ${panel?.slice(0, 300)}`);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-aiphoto.png"), fullPage: false });
}
console.log(`\npage errors: ${pageErrors.length}`);
await browser.close();
