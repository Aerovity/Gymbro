// Frame sampling, full-res grabs, contact sheets, payload fitting and crop rendering (browser only).
import type { CropBox, SampledFrame } from "../types";
import { SCAN_PAYLOAD_BUDGET } from "../schemas";
import { seekTo } from "./seek";
import { burnTimestamp, formatTimestamp } from "./burnTimestamp";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SampleOptions {
  fps?: number; // requested fps (default 4)
  maxFrames?: number; // default 40
  longEdge?: number; // default 448
  quality?: number; // JPEG quality, default 0.7
  burnTimestamp?: boolean; // default true
  start?: number; // optional trim window (s)
  end?: number;
  signal?: AbortSignal;
}

// ───────────── pure helpers ─────────────

/** Scale (w,h) so the long edge is ≤ longEdge (never upscales). Rounded to even pixels ≥ 2. */
export function scaledSize(w: number, h: number, longEdge: number): { width: number; height: number } {
  const s = Math.min(1, longEdge / Math.max(w, h, 1));
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

/**
 * Sample times for a window. If duration*fps exceeds maxFrames the fps is lowered to
 * maxFrames/duration. Times are at the centre of each 1/fps slot so the first and last
 * frames stay away from the clip edges.
 */
export function planSampleTimes(
  duration: number,
  fps: number,
  maxFrames: number,
  start = 0,
  end = duration,
): { times: number[]; effectiveFps: number } {
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  const span = e - s;
  if (span <= 0) return { times: [s], effectiveFps: fps };
  let eff = fps;
  if (span * fps > maxFrames) eff = maxFrames / span;
  const n = Math.max(1, Math.min(maxFrames, Math.floor(span * eff + 1e-9)));
  const step = 1 / eff;
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(Math.round((s + step * (i + 0.5)) * 1000) / 1000);
  return { times: times.filter((t) => t <= e), effectiveFps: Math.round(eff * 1000) / 1000 };
}

/** Sum of data URL lengths (what actually goes in the JSON body). */
export function payloadBytes(frames: ReadonlyArray<{ dataUrl: string }>): number {
  let n = 0;
  for (const f of frames) n += f.dataUrl.length;
  return n;
}

/** Keep indices 0,2,4… (always at least one frame). */
export function dropEveryOther<T>(frames: readonly T[]): T[] {
  if (frames.length <= 1) return frames.slice();
  return frames.filter((_, i) => i % 2 === 0);
}

export interface FitResult {
  frames: SampledFrame[];
  bytes: number;
  reencoded: boolean;
  /** Multiply the sampling effectiveFps by this (0.5 per halving). */
  fpsScale: number;
  dropped: number;
}

/**
 * Budgeting logic with an injectable re-encoder (pure apart from `reencode`).
 * 1) within budget → unchanged. 2) re-encode all at q 0.55. 3) halve until within budget.
 */
export async function fitPayloadWith(
  frames: SampledFrame[],
  budget: number,
  reencode: (f: SampledFrame, quality: number) => Promise<SampledFrame>,
): Promise<FitResult> {
  let cur = frames.slice();
  let bytes = payloadBytes(cur);
  if (bytes <= budget) return { frames: cur, bytes, reencoded: false, fpsScale: 1, dropped: 0 };
  cur = await Promise.all(cur.map((f) => reencode(f, 0.55)));
  bytes = payloadBytes(cur);
  let fpsScale = 1;
  while (bytes > budget && cur.length > 1) {
    cur = dropEveryOther(cur);
    fpsScale /= 2;
    bytes = payloadBytes(cur);
  }
  return { frames: cur, bytes, reencoded: true, fpsScale, dropped: frames.length - cur.length };
}

/** Evenly spaced indices (n of len), including first and last. */
export function evenIndices(len: number, n: number): number[] {
  if (len <= 0) return [];
  if (len <= n) return Array.from({ length: len }, (_, i) => i);
  if (n === 1) return [Math.floor(len / 2)];
  return Array.from({ length: n }, (_, i) => Math.round((i * (len - 1)) / (n - 1)));
}

/** Intersection of a crop rect with the source bounds. */
export function cropIntersection(crop: Pick<CropBox, "x" | "y" | "w" | "h">, srcW: number, srcH: number) {
  const x0 = Math.max(0, crop.x);
  const y0 = Math.max(0, crop.y);
  const x1 = Math.min(srcW, crop.x + crop.w);
  const y1 = Math.min(srcH, crop.y + crop.h);
  return { x0, y0, x1, y1, empty: x1 <= x0 || y1 <= y0 };
}

// ───────────── canvas helpers ─────────────

export function makeCanvas(w: number, h: number, preferOffscreen = true): AnyCanvas {
  if (preferOffscreen && typeof OffscreenCanvas !== "undefined") {
    try {
      const c = new OffscreenCanvas(w, h);
      if (c.getContext("2d")) return c;
    } catch {
      /* fall through */
    }
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

export async function canvasToDataUrl(c: AnyCanvas, quality: number, type = "image/jpeg"): Promise<string> {
  if (typeof OffscreenCanvas !== "undefined" && c instanceof OffscreenCanvas) {
    return blobToDataUrl(await c.convertToBlob({ type, quality }));
  }
  return (c as HTMLCanvasElement).toDataURL(type, quality);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

export type DrawableSource = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | HTMLVideoElement | ImageBitmap;

export function sourceSize(src: DrawableSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement)
    return { width: src.videoWidth, height: src.videoHeight };
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement)
    return { width: src.naturalWidth || src.width, height: src.naturalHeight || src.height };
  return { width: (src as HTMLCanvasElement).width, height: (src as HTMLCanvasElement).height };
}

const abortErr = () => new DOMException("Aborted", "AbortError");

// ───────────── sampling ─────────────

/** Sequential seeks on one element; each frame is scaled, optionally timestamp-burned and JPEG-encoded. */
export async function sampleFrames(
  video: HTMLVideoElement,
  opts: SampleOptions = {},
  onFrame?: (f: SampledFrame, index: number, total: number) => void,
): Promise<{ frames: SampledFrame[]; effectiveFps: number }> {
  const { fps = 4, maxFrames = 40, longEdge = 448, quality = 0.7, burnTimestamp: burn = true } = opts;
  const { times, effectiveFps } = planSampleTimes(video.duration, fps, maxFrames, opts.start ?? 0, opts.end ?? video.duration);
  const { width, height } = scaledSize(video.videoWidth, video.videoHeight, longEdge);
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  const frames: SampledFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    if (opts.signal?.aborted) throw abortErr();
    const t = times[i];
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    if (burn) burnTimestamp(ctx, t, width, height);
    const f: SampledFrame = { t, dataUrl: await canvasToDataUrl(canvas, quality), width, height };
    frames.push(f);
    onFrame?.(f, i, times.length);
  }
  return { frames, effectiveFps };
}

/** Full-resolution grab of one frame (HTMLCanvasElement for pose + JPEG for coach/edit). */
export async function grabFrame(
  video: HTMLVideoElement,
  t: number,
  opts: { longEdge?: number; quality?: number } = {},
): Promise<{ canvas: HTMLCanvasElement; dataUrl: string; width: number; height: number }> {
  const { longEdge = 1536, quality = 0.9 } = opts;
  await seekTo(video, t);
  const { width, height } = scaledSize(video.videoWidth, video.videoHeight, longEdge);
  const canvas = makeCanvas(width, height, false) as HTMLCanvasElement;
  ctx2d(canvas).drawImage(video, 0, 0, width, height);
  return { canvas, dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

/** Draw the current frame (no seek) into a reusable canvas at a given long edge. */
export function drawVideoFrame(video: HTMLVideoElement, canvas: AnyCanvas, longEdge: number): { width: number; height: number } {
  const { width, height } = scaledSize(video.videoWidth, video.videoHeight, longEdge);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx2d(canvas).drawImage(video, 0, 0, width, height);
  return { width, height };
}

/** 4×4 grid of evenly spaced frames, each labelled with its t. */
export async function makeContactSheet(
  frames: SampledFrame[],
  n = 16,
): Promise<{ dataUrl: string; timestamps: number[] }> {
  const idx = evenIndices(frames.length, n);
  const picked = idx.map((i) => frames[i]);
  const cols = 4;
  const rows = Math.max(1, Math.ceil(picked.length / cols));
  const fw = picked[0]?.width ?? 448;
  const fh = picked[0]?.height ?? 448;
  const s = Math.min(1, 1536 / (fw * cols), 1536 / (fh * rows));
  const cw = Math.round(fw * s);
  const ch = Math.round(fh * s);
  const canvas = makeCanvas(cw * cols, ch * rows);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#07090C";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const imgs = await Promise.all(picked.map((f) => loadImage(f.dataUrl)));
  const fontPx = Math.max(12, Math.round(ch * 0.07));
  imgs.forEach((img, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.drawImage(img, x, y, cw, ch);
    const label = `${i + 1} · ${formatTimestamp(picked[i].t)}`;
    ctx.font = `bold ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(x + 4, y + 4, tw + 12, fontPx + 8);
    ctx.fillStyle = "#C6FF3D";
    ctx.textBaseline = "top";
    ctx.fillText(label, x + 10, y + 8);
    ctx.strokeStyle = "#07090C";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, cw, ch);
  });
  return { dataUrl: await canvasToDataUrl(canvas, 0.8), timestamps: picked.map((f) => f.t) };
}

async function reencodeFrame(f: SampledFrame, quality: number): Promise<SampledFrame> {
  const img = await loadImage(f.dataUrl);
  const c = makeCanvas(f.width, f.height);
  ctx2d(c).drawImage(img, 0, 0, f.width, f.height);
  return { ...f, dataUrl: await canvasToDataUrl(c, quality) };
}

/** Like fitPayload but also reports what was done (use `fpsScale` to correct effectiveFps). */
export function fitPayloadDetailed(frames: SampledFrame[], budget: number = SCAN_PAYLOAD_BUDGET): Promise<FitResult> {
  return fitPayloadWith(frames, budget, reencodeFrame);
}

/**
 * Keep the sum of data URL lengths ≤ budget: re-encode at q 0.55, then drop every other frame.
 * If frames were dropped, the effective fps is lower: `frames.length / duration` (or use fitPayloadDetailed).
 */
export async function fitPayload(frames: SampledFrame[], budget: number = SCAN_PAYLOAD_BUDGET): Promise<SampledFrame[]> {
  return (await fitPayloadDetailed(frames, budget)).frames;
}

// ───────────── crop rendering ─────────────

/**
 * Render a CropBox to exactly outW×outH. Area outside the source is filled with a
 * blurred edge-replicate of the nearest source pixels.
 */
export function renderCrop(
  source: DrawableSource,
  crop: CropBox,
  quality = 0.92,
): { canvas: HTMLCanvasElement; dataUrl: string } {
  const { width: sw, height: sh } = sourceSize(source);
  const out = document.createElement("canvas");
  out.width = crop.outW;
  out.height = crop.outH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#07090C";
  ctx.fillRect(0, 0, out.width, out.height);
  const sx = crop.outW / crop.w;
  const sy = crop.outH / crop.h;
  const I = cropIntersection(crop, sw, sh);
  if (!I.empty) {
    // destination rect of the in-source part
    const dx0 = (I.x0 - crop.x) * sx;
    const dy0 = (I.y0 - crop.y) * sy;
    const dx1 = (I.x1 - crop.x) * sx;
    const dy1 = (I.y1 - crop.y) * sy;
    const padded = dx0 > 0.5 || dy0 > 0.5 || dx1 < out.width - 0.5 || dy1 < out.height - 0.5;
    if (padded) {
      const pad = document.createElement("canvas");
      pad.width = out.width;
      pad.height = out.height;
      const p = pad.getContext("2d")!;
      const e = 2; // edge strip thickness (source px)
      const W = out.width;
      const H = out.height;
      const sxw = I.x1 - I.x0;
      const syh = I.y1 - I.y0;
      // centre (stretched, so corners/edges are covered even before strips)
      p.drawImage(source, I.x0, I.y0, sxw, syh, 0, 0, W, H);
      // left / right strips
      if (dx0 > 0) p.drawImage(source, I.x0, I.y0, e, syh, 0, dy0, dx0, dy1 - dy0);
      if (dx1 < W) p.drawImage(source, I.x1 - e, I.y0, e, syh, dx1, dy0, W - dx1, dy1 - dy0);
      // top / bottom strips
      if (dy0 > 0) p.drawImage(source, I.x0, I.y0, sxw, e, dx0, 0, dx1 - dx0, dy0);
      if (dy1 < H) p.drawImage(source, I.x0, I.y1 - e, sxw, e, dx0, dy1, dx1 - dx0, H - dy1);
      // corners
      if (dx0 > 0 && dy0 > 0) p.drawImage(source, I.x0, I.y0, e, e, 0, 0, dx0, dy0);
      if (dx1 < W && dy0 > 0) p.drawImage(source, I.x1 - e, I.y0, e, e, dx1, 0, W - dx1, dy0);
      if (dx0 > 0 && dy1 < H) p.drawImage(source, I.x0, I.y1 - e, e, e, 0, dy1, dx0, H - dy1);
      if (dx1 < W && dy1 < H) p.drawImage(source, I.x1 - e, I.y1 - e, e, e, dx1, dy1, W - dx1, H - dy1);
      const blur = Math.max(8, Math.round(Math.min(W, H) * 0.03));
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      // overdraw slightly so blurred edges don't fade to transparent
      ctx.drawImage(pad, -blur * 2, -blur * 2, W + blur * 4, H + blur * 4);
      ctx.restore();
    }
    ctx.drawImage(source, I.x0, I.y0, I.x1 - I.x0, I.y1 - I.y0, dx0, dy0, dx1 - dx0, dy1 - dy0);
  }
  return { canvas: out, dataUrl: out.toDataURL("image/jpeg", quality) };
}
