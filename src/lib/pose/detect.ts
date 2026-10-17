// Pose detection wrappers (browser only). Returns the lifter only.
import type { Landmark, PoseResult } from "../types";
import { getImageLandmarker, getVideoLandmarker } from "./landmarker";
import { selectLifter } from "./select";

export type PoseSource = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | HTMLVideoElement | ImageBitmap | ImageData;

type RawLm = { x: number; y: number; z: number; visibility?: number };
interface RawResult {
  landmarks: RawLm[][];
  worldLandmarks: RawLm[][];
  close?: () => void;
}

const copy = (arr: readonly RawLm[] | undefined): Landmark[] =>
  (arr ?? []).map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }));

/** Convert a raw MediaPipe result to the lifter's PoseResult (pure). */
export function toPoseResult(res: RawResult, w: number, h: number): PoseResult | null {
  const all = (res.landmarks ?? []).map(copy);
  const idx = selectLifter(all);
  if (idx < 0) return null;
  return { landmarks: all[idx], worldLandmarks: copy(res.worldLandmarks?.[idx]), width: w, height: h };
}

function testHook() {
  return typeof window !== "undefined" ? window.__GYMBRO_TEST__?.detect : undefined;
}

/** IMAGE-mode heavy detection. Landmarks are normalised to the source (w×h pixels). */
export async function detectPose(source: PoseSource, w: number, h: number): Promise<PoseResult | null> {
  const hook = testHook();
  if (hook) return (await hook(source, w, h, "image")) ?? null;
  const lm = await getImageLandmarker();
  const res = lm.detect(source) as unknown as RawResult;
  try {
    return toPoseResult(res, w, h);
  } finally {
    res.close?.();
  }
}

/** Load an image URL (e.g. the edited "after" image) and detect. */
export async function detectPoseFromUrl(url: string): Promise<PoseResult | null> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("image load failed"));
    i.src = url;
  });
  return detectPose(img, img.naturalWidth, img.naturalHeight);
}

let lastVideoTs = -1;

/**
 * VIDEO-mode lite detection. MediaPipe requires strictly increasing timestamps per landmarker,
 * so a backwards/equal `tMs` is remapped onto a monotonically increasing clock.
 */
export async function detectVideoFrame(canvas: PoseSource, tMs: number, w?: number, h?: number): Promise<PoseResult | null> {
  const W = w ?? (canvas as HTMLCanvasElement).width;
  const H = h ?? (canvas as HTMLCanvasElement).height;
  const hook = testHook();
  if (hook) return (await hook(canvas, W, H, "video")) ?? null;
  const lm = await getVideoLandmarker();
  const ts = tMs > lastVideoTs ? tMs : lastVideoTs + 1000; // jump marks a discontinuity
  lastVideoTs = ts;
  const res = lm.detectForVideo(canvas, Math.round(ts)) as unknown as RawResult;
  lastVideoTs = Math.round(ts);
  try {
    return toPoseResult(res, W, H);
  } finally {
    res.close?.();
  }
}
