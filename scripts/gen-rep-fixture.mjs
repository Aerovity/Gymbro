// Captures a 3D rep (world landmarks @12 fps) via /dev/pose?rep=<t> and writes public/demo/<id>/rep.json.
// Usage: node scripts/gen-rep-fixture.mjs <demoId> <t> [baseUrl]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [id = "pullup", t = "13.4", base = process.env.BASE_URL ?? "http://localhost:3000"] = process.argv.slice(2);
const exercise = process.env.EXERCISE ?? "pull_up";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const qs = new URLSearchParams({ src: `/demo/${id}/video.mp4`, exercise, rep: t });
  await page.goto(`${base}/dev/pose?${qs}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__DEV_POSE__ !== undefined, null, { timeout: 180_000 });
  const data = await page.evaluate(() => window.__DEV_POSE__);
  if (data?.error) throw new Error(data.error);
  const round = (n) => Math.round(n * 10000) / 10000;
  const frames = data.frames.map((f) => ({
    t: f.t,
    world: f.world.map((l) => ({ x: round(l.x), y: round(l.y), z: round(l.z), visibility: round(l.visibility) })),
  }));
  fs.writeFileSync(`public/demo/${id}/rep.json`, JSON.stringify({ t: Number(t), fps: 12, frames }));
  console.log(`wrote public/demo/${id}/rep.json (${frames.length} frames)`);
} finally {
  await browser.close();
}
