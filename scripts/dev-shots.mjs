// Agent D visual QA: screenshot / and /dev/gallery stages at desktop + mobile.
// Usage: node scripts/dev-shots.mjs [outDir] [baseUrl] [only-comma-list]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? "shots";
const base = process.argv[3] ?? "http://localhost:3102";
const only = process.argv[4]?.split(",");
fs.mkdirSync(out, { recursive: true });

const pages = [
  ["landing", "/"],
  ["gallery", "/dev/gallery"],
  ["analyze", "/analyze?demo=pullup"],
  ...["idle", "probing", "sampling", "scanning", "picking", "posing", "coaching", "correcting", "verifying", "done", "error", "afterFailed", "coachFallback", "scanFallback", "demo"].map((s) => [s, `/dev/gallery?stage=${s}`]),
].filter(([n]) => !only || only.includes(n));

const sizes = [
  ["desk", { width: 1440, height: 900 }],
  ["mob", { width: 390, height: 844 }],
];

const browser = await chromium.launch({ channel: "chrome" });
for (const [sname, vp] of sizes) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[pageerror ${sname}]`, e.message));
  for (const [name, url] of pages) {
    await page.goto(base + url, { waitUntil: "load" }).catch(() => {});
    if (name === "analyze") {
      let last = 0;
      for (const t of [2, 6, 12, 20, 32, 45]) {
        await page.waitForTimeout((t - last) * 1000);
        last = t;
        const st = await page.evaluate(() => document.querySelector("[data-stage]")?.getAttribute("data-stage"));
        await page.screenshot({ path: path.join(out, `analyze-${t}s-${st}-${sname}.png`) });
        console.log("shot analyze", t, st, sname);
      }
      await page.screenshot({ path: path.join(out, `analyze-final-full-${sname}.png`), fullPage: true });
      continue;
    }
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(1600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) console.log(`[overflow] ${name} ${sname}: ${overflow}px`);
    await page.screenshot({ path: path.join(out, `${name}-${sname}.png`), fullPage: name === "landing" || name === "gallery" || process.env.FULL === "1" });
    console.log("shot", name, sname);
  }
  await ctx.close();
}
await browser.close();
