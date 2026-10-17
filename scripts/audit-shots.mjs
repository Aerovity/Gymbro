// Full-page UX audit screenshots: node scripts/audit-shots.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test";
const [out = ".", base = "http://localhost:3000"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, vp] of [["desk", { width: 1440, height: 900 }], ["mob", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  await page.goto(`${base}/`);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/a-landing-${name}.png`, fullPage: true });
  await page.goto(`${base}/analyze?demo=pullup`);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}/a-progress-${name}.png`, fullPage: true });
  await page.waitForSelector('[data-testid="step-verify"][data-status="done"]', { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/a-done-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log("ok");
