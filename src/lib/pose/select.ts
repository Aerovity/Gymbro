// Pure lifter-selection and bounding-box helpers (unit-tested; no DOM).
import type { Landmark } from "../types";
import { LM, VISIBILITY_MIN } from "./landmarks";

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  area: number;
}

export const TORSO = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP] as const;

/** Bounding box of the given landmark indices (all when omitted) with visibility ≥ minVis. Null if none. */
export function landmarksBBox(
  landmarks: readonly Landmark[],
  indices?: readonly number[],
  minVis = 0,
): BBox | null {
  const idx = indices ?? landmarks.map((_, i) => i);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let n = 0;
  for (const i of idx) {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.visibility ?? 0) < minVis) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
    n++;
  }
  if (n === 0) return null;
  const w = x1 - x0;
  const h = y1 - y0;
  return { x0, y0, x1, y1, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, area: w * h };
}

/** Torso (shoulders + hips) bbox, ignoring visibility (MediaPipe always estimates them). */
export const torsoBBox = (landmarks: readonly Landmark[]) => landmarksBBox(landmarks, TORSO);

/** Score for "is this the lifter": large torso, near the image centre. Coordinates normalised 0–1. */
export function lifterScore(landmarks: readonly Landmark[]): number {
  const b = torsoBBox(landmarks);
  if (!b) return -Infinity;
  // Use the torso diagonal² so a side-on (thin) torso is not penalised to zero area.
  const size = b.w * b.h + 0.25 * b.h * b.h;
  const dist = Math.hypot(b.cx - 0.5, b.cy - 0.5); // 0 … ~0.71
  const centre = 1 - 0.6 * Math.min(1, dist / 0.5);
  return size * centre;
}

/** Index of the lifter among detected poses (-1 if none). */
export function selectLifter(poses: ReadonlyArray<readonly Landmark[]>): number {
  let best = -1;
  let bestScore = -Infinity;
  poses.forEach((p, i) => {
    if (!p || p.length < 25) return;
    const s = lifterScore(p);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}

/** Mean visibility of the given landmark indices. */
export function meanVisibility(landmarks: readonly Landmark[], indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let s = 0;
  for (const i of indices) s += landmarks[i]?.visibility ?? 0;
  return s / indices.length;
}

/** True when every listed landmark has visibility ≥ min. */
export function allVisible(landmarks: readonly Landmark[], indices: readonly number[], min = VISIBILITY_MIN): boolean {
  return indices.every((i) => (landmarks[i]?.visibility ?? 0) >= min);
}
