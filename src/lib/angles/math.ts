// Pure 2D/3D angle math (spec §7.6). Points are in PIXELS unless stated otherwise.
import type { Landmark, Pt, Pt3 } from "../types";

const DEG = 180 / Math.PI;
const EPS = 1e-9;

const finite = (...ns: number[]) => ns.every((n) => Number.isFinite(n));

/** Normalised landmark → pixel point (fixes aspect distortion before any angle). */
export function toPx(lm: Pick<Landmark, "x" | "y">, W: number, H: number): Pt {
  return { x: lm.x * W, y: lm.y * H };
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle at B between A–B–C in degrees (0–180), via atan2(|cross|, dot). Null if degenerate. */
export function angleAt(a: Pt, b: Pt, c: Pt): number | null {
  if (!finite(a.x, a.y, b.x, b.y, c.x, c.y)) return null;
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  if (Math.hypot(bax, bay) < EPS || Math.hypot(bcx, bcy) < EPS) return null;
  const cross = bax * bcy - bay * bcx;
  const dot = bax * bcx + bay * bcy;
  return Math.atan2(Math.abs(cross), dot) * DEG;
}

/** 3D interior angle at B (e.g. on worldLandmarks). Null if degenerate. */
export function angleAt3(a: Pt3, b: Pt3, c: Pt3): number | null {
  if (!finite(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)) return null;
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  if (Math.hypot(u[0], u[1], u[2]) < EPS || Math.hypot(v[0], v[1], v[2]) < EPS) return null;
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.atan2(Math.hypot(cx, cy, cz), dot) * DEG;
}

/** Inclination of segment P→Q from vertical, 0° = vertical, 90° = horizontal. Null if P≈Q. */
export function inclinationFromVertical(p: Pt, q: Pt): number | null {
  if (!finite(p.x, p.y, q.x, q.y)) return null;
  const dx = Math.abs(q.x - p.x);
  const dy = Math.abs(p.y - q.y);
  if (Math.hypot(dx, dy) < EPS) return null;
  return Math.atan2(dx, dy) * DEG;
}

/** Tilt of line P–Q from horizontal, 0° = level, 90° = vertical. Null if P≈Q. */
export function lineTiltFromHorizontal(p: Pt, q: Pt): number | null {
  if (!finite(p.x, p.y, q.x, q.y)) return null;
  const dx = Math.abs(q.x - p.x);
  const dy = Math.abs(q.y - p.y);
  if (Math.hypot(dx, dy) < EPS) return null;
  return Math.atan2(dy, dx) * DEG;
}

/** 3-tap median filter. Nulls are ignored inside a window; a null centre stays null. Edges use 2-tap windows. */
export function median3(series: ReadonlyArray<number | null>): (number | null)[] {
  return series.map((v, i) => {
    if (v === null || !Number.isFinite(v)) return null;
    const win = [series[i - 1], v, series[i + 1]].filter(
      (x): x is number => typeof x === "number" && Number.isFinite(x),
    );
    win.sort((a, b) => a - b);
    if (win.length === 3) return win[1];
    if (win.length === 2) return (win[0] + win[1]) / 2;
    return win[0];
  });
}

export function round(n: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
