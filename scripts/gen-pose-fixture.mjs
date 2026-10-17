// Generate pose fixtures from the real browser pipeline via the /dev/pose page.
//
// Usage:
//   node scripts/gen-pose-fixture.mjs <demoId|videoPath> <t> [outDir|out.json] [baseUrl]
//   node scripts/gen-pose-fixture.mjs pullup 7.2 out/pullup
//   node scripts/gen-pose-fixture.mjs pullup scan [out.json]        # pose-only scan mode
//
// A running server is required (BASE_URL env or 4th arg, default http://localhost:3000).
// Uses Google Chrome (channel "chrome"): Playwright's bundled Chromium cannot decode H.264.
//
// Writes into outDir:
//   pose.json       PoseResult in crop space (landmarks normalised to the cropped frame)
//   frame.jpg       the cropped "before" frame (exact crop output size)
//   pose-full.json  { t, src, crop, pose, rawPose, report?, timings } (no data URL)
// If the 3rd arg ends in .json it is used as the pose.json path and the others go next to it.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [target, tArg, outArg, baseArg] = process.argv.slice(2);
if (!target || !tArg) {
  console.error("Usage: node scripts/gen-pose-fixture.mjs <demoId|videoPath> <t|scan> [outDir|out.json] [baseUrl]");
  process.exit(1);
}
const baseUrl = (baseArg || process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const src = target.includes("/") || target.includes(".") ? target : `/demo/${target}/video.mp4`;
const scan = tArg === "scan";
const exercise = process.env.EXERCISE || "pull_up";

const qs = new URLSearchParams({ src, exercise });
if (scan) qs.set("scan", "1");
else qs.set("t", String(Number(tArg)));
const url = `${baseUrl}/dev/pose?${qs}`;

const browser = await chromium.launch({ channel: "chrome", headless: process.env.HEADED ? false : true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => {
    if (process.env.VERBOSE || m.type() === "error") console.error(`[browser:${m.type()}] ${m.text()}`);
  });
  console.error(`→ ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__DEV_POSE__ !== undefined, null, { timeout: 180_000 });
  const data = await page.evaluate(() => window.__DEV_POSE__);
  if (data?.error) throw new Error(`dev page error: ${data.error}`);

  if (scan) {
    const json = JSON.stringify(data, null, 2);
    if (outArg) {
      fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
      fs.writeFileSync(outArg, json);
      console.error(`wrote ${outArg}`);
    } else process.stdout.write(json + "\n");
  } else {
    const outDir = !outArg ? path.resolve(".pose-fixture", `${target.replace(/[^\w.-]+/g, "_")}-${tArg}`)
      : outArg.endsWith(".json") ? path.dirname(path.resolve(outArg)) : path.resolve(outArg);
    const posePath = outArg?.endsWith(".json") ? path.resolve(outArg) : path.join(outDir, "pose.json");
    fs.mkdirSync(outDir, { recursive: true });
    const { frameDataUrl, ...rest } = data;
    fs.writeFileSync(posePath, JSON.stringify(data.pose, null, 2));
    fs.writeFileSync(path.join(outDir, "pose-full.json"), JSON.stringify({ src, ...rest }, null, 2));
    const b64 = String(frameDataUrl).replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(path.join(outDir, "frame.jpg"), Buffer.from(b64, "base64"));
    console.error(`wrote ${posePath}, frame.jpg, pose-full.json in ${outDir}`);
    console.log(JSON.stringify({ t: data.t, crop: data.crop, landmarks: data.pose?.landmarks?.length ?? 0, timings: data.timings }));
  }
} finally {
  await browser.close();
}
