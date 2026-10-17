// Downloads MediaPipe pose landmarker models into public/models (skips files already present).
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker";
const MODELS = ["heavy", "lite"].map((v) => ({
  url: `${BASE}/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`,
  file: resolve(`public/models/pose_landmarker_${v}.task`),
}));

mkdirSync(resolve("public/models"), { recursive: true });
for (const m of MODELS) {
  if (existsSync(m.file) && statSync(m.file).size > 1_000_000) continue;
  try {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(m.file, Buffer.from(await res.arrayBuffer()));
    console.log("[download-pose-model] saved", m.file);
  } catch (e) {
    console.warn("[download-pose-model] failed", m.url, String(e), "- the app falls back to the remote URL");
  }
}
