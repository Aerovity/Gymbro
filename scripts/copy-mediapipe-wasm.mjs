// Copies the MediaPipe tasks-vision wasm runtime into public/ so pose runs fully offline.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve("node_modules/@mediapipe/tasks-vision/wasm");
const dest = resolve("public/mediapipe/wasm");
if (!existsSync(src)) {
  console.warn("[copy-mediapipe-wasm] @mediapipe/tasks-vision not installed yet; skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-mediapipe-wasm] copied wasm ->", dest);
