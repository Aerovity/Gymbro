// 3D pose maths for the mannequin viewer (pure, no three.js / DOM).
// MediaPipe worldLandmarks are metres, hip-centred, x → subject's left-to-right in image,
// y DOWN, z toward the camera is negative. Scene space is y UP, so we flip y and z.
import type { AngleReport, ExerciseId, Landmark } from "../types";
import { LM } from "../pose/landmarks";
import { subtree, mirrorIndex } from "../angles/ghost";

export type V3 = [number, number, number];

export interface RepFrame {
  t: number; // seconds in the clip
  world: Landmark[]; // 33 MediaPipe world landmarks
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const mid3 = (a: V3, b: V3): V3 => scale(add(a, b), 0.5);
const DEG = 180 / Math.PI;

/** Interior angle at b (degrees) in 3D, null if degenerate. */
export function angle3(a: V3, b: V3, c: V3): number | null {
  const ba = sub(a, b);
  const bc = sub(c, b);
  if (len(ba) < 1e-9 || len(bc) < 1e-9) return null;
  return Math.atan2(len(cross(ba, bc)), dot(ba, bc)) * DEG;
}

/** Rodrigues rotation of p about the axis through `origin` with unit direction `axis`. */
export function rotateAboutAxis(p: V3, origin: V3, axis: V3, rad: number): V3 {
  const v = sub(p, origin);
  const k = scale(axis, 1 / (len(axis) || 1));
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const term1 = scale(v, cos);
  const term2 = scale(cross(k, v), sin);
  const term3 = scale(k, dot(k, v) * (1 - cos));
  return add(origin, add(term1, add(term2, term3)));
}

/** MediaPipe world landmark → scene coordinates (y up, z toward viewer). */
export function toScene(world: readonly Landmark[]): V3[] {
  return world.map((l) => [l.x, -l.y, -l.z] as V3);
}

/** Lowest scene y across frames (feet / hands), used to stand the mannequin on the floor. */
export function floorOffset(frames: readonly V3[][]): number {
  let min = Infinity;
  for (const f of frames) for (const p of f) min = Math.min(min, p[1]);
  return Number.isFinite(min) ? -min : 0;
}

/** Centred moving average over time per landmark (window 2r+1); keeps endpoints stable. */
export function smoothFrames(frames: readonly V3[][], r = 1): V3[][] {
  if (frames.length < 3 || r < 1) return frames.map((f) => f.map((p) => [...p] as V3));
  return frames.map((_, i) => {
    const lo = Math.max(0, i - r);
    const hi = Math.min(frames.length - 1, i + r);
    const n = hi - lo + 1;
    return frames[i].map((_, j) => {
      let x = 0, y = 0, z = 0;
      for (let k = lo; k <= hi; k++) {
        x += frames[k][j][0];
        y += frames[k][j][1];
        z += frames[k][j][2];
      }
      return [x / n, y / n, z / n] as V3;
    });
  });
}

/** Linear interpolation between two poses. */
export function lerpPose(a: readonly V3[], b: readonly V3[], u: number): V3[] {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * u, p[1] + (b[i][1] - p[1]) * u, p[2] + (b[i][2] - p[2]) * u] as V3);
}

/** Pose at time t from a frame sequence (linear interpolation, clamped). */
export function sampleSequence(frames: readonly V3[][], times: readonly number[], t: number): V3[] {
  if (!frames.length) return [];
  if (t <= times[0]) return frames[0].map((p) => [...p] as V3);
  const last = frames.length - 1;
  if (t >= times[last]) return frames[last].map((p) => [...p] as V3);
  let i = 0;
  while (i < last && times[i + 1] < t) i++;
  const u = (t - times[i]) / (times[i + 1] - times[i] || 1);
  return lerpPose(frames[i], frames[i + 1], u);
}

// ───────────────────────────── corrections ─────────────────────────────

export type Correction =
  | { kind: "joint"; points: [number, number, number]; min?: number; max?: number; ideal: number; local: boolean; key: string }
  | { kind: "level-shoulders"; key: string; local: boolean }
  | { kind: "straighten-knees"; key: string; ideal: number; local: boolean };

/**
 * Turns the measured violations of the chosen moment into 3D corrections.
 * `local` = the rule only applies at the flagged phase (blend in/out around the moment).
 */
export function correctionsFrom(report: AngleReport): Correction[] {
  const out: Correction[] = [];
  for (const v of report.violations) {
    const m = report.angles.find((a) => a.key === v.angleKey);
    if (v.angleKey === "shoulder_tilt") {
      out.push({ kind: "level-shoulders", key: v.angleKey, local: false });
      continue;
    }
    if (v.angleKey === "knee_angle" && report.exercise === "pull_up") {
      out.push({ kind: "straighten-knees", key: v.angleKey, ideal: v.target.ideal, local: false });
      continue;
    }
    if (m?.points && m.unit === "°") {
      out.push({
        kind: "joint",
        points: m.points,
        min: v.target.min,
        max: v.target.max,
        ideal: v.target.ideal,
        local: true,
        key: v.angleKey,
      });
    }
  }
  return out;
}

/** Rotate the distal subtree at joint b so that angle(a,b,c) moves to `target` (3D, in the a-b-c plane). */
export function setJointAngle3(pts: V3[], [a, b, c]: [number, number, number], target: number): boolean {
  const below = subtree(b);
  const distal = c !== b && below.includes(c) ? c : a !== b && below.includes(a) ? a : null;
  if (distal === null) return false;
  const prox = distal === c ? a : c;
  const cur = angle3(pts[prox], pts[b], pts[distal]);
  if (cur === null) return false;
  const B = pts[b];
  const axis = cross(sub(pts[prox], B), sub(pts[distal], B));
  if (len(axis) < 1e-9) return false;
  // Rotating the distal segment about (BA × BC) by +δ opens the angle by δ.
  const delta = (target - cur) / DEG;
  for (const i of subtree(distal)) pts[i] = rotateAboutAxis(pts[i], B, axis, delta);
  return true;
}

function levelShoulders(pts: V3[], w: number) {
  const l = pts[LM.L_SHOULDER];
  const r = pts[LM.R_SHOULDER];
  const centre = mid3(l, r);
  const d = sub(r, l);
  // Tilt of the shoulder line out of the horizontal plane; rotate the upper body about the forward axis.
  const horiz = Math.hypot(d[0], d[2]);
  const tilt = Math.atan2(d[1], horiz);
  const fwd = cross(d, [0, 1, 0]);
  if (len(fwd) < 1e-9) return;
  const upper = new Set<number>([LM.NOSE, 1, 2, 3, 4, 5, 6, LM.L_EAR, LM.R_EAR, 9, 10, LM.L_SHOULDER, LM.R_SHOULDER]);
  for (const s of [LM.L_SHOULDER, LM.R_SHOULDER]) for (const i of subtree(s === LM.L_SHOULDER ? LM.L_ELBOW : LM.R_ELBOW)) upper.add(i);
  for (const i of upper) pts[i] = rotateAboutAxis(pts[i], centre, fwd, -tilt * w);
}

/** What stays fixed in the world when the form is corrected (hands on the bar, feet on the floor…). */
export const ANCHORS: Record<ExerciseId, number[]> = {
  pull_up: [LM.L_WRIST, LM.R_WRIST],
  squat: [LM.L_ANKLE, LM.R_ANKLE],
  deadlift: [LM.L_ANKLE, LM.R_ANKLE],
  overhead_press: [LM.L_ANKLE, LM.R_ANKLE],
  biceps_curl: [LM.L_ANKLE, LM.R_ANKLE],
  bench_press: [LM.L_HIP, LM.R_HIP],
};

const centroid = (pts: readonly V3[], idx: readonly number[]): V3 =>
  scale(idx.reduce<V3>((acc, i) => add(acc, pts[i]), [0, 0, 0]), 1 / (idx.length || 1));

/** Apply corrections to one pose. `w` ∈ [0,1] = strength (phase blend for local rules). */
export function correctPose(pose: readonly V3[], corrections: readonly Correction[], w = 1, wLocal = w, anchor: readonly number[] = []): V3[] {
  const pts = pose.map((p) => [...p] as V3);
  const anchorBefore = anchor.length ? centroid(pts, anchor) : null;
  for (const c of corrections) {
    const s = c.local ? wLocal : w;
    if (s <= 0) continue;
    if (c.kind === "level-shoulders") {
      levelShoulders(pts, s);
    } else if (c.kind === "straighten-knees") {
      for (const tri of [
        [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
        [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
      ] as [number, number, number][]) {
        const cur = angle3(pts[tri[0]], pts[tri[1]], pts[tri[2]]);
        if (cur !== null && cur < c.ideal) setJointAngle3(pts, tri, cur + (c.ideal - cur) * s);
      }
    } else {
      // Fix the measured side and its mirror (symmetric lifts).
      for (const tri of [c.points, c.points.map(mirrorIndex) as [number, number, number]]) {
        const cur = angle3(pts[tri[0]], pts[tri[1]], pts[tri[2]]);
        if (cur === null) continue;
        const outside = (c.max !== undefined && cur > c.max) || (c.min !== undefined && cur < c.min);
        if (!outside) continue;
        setJointAngle3(pts, tri, cur + (c.ideal - cur) * s);
      }
    }
  }
  if (anchorBefore) {
    const shift = sub(anchorBefore, centroid(pts, anchor));
    for (let i = 0; i < pts.length; i++) pts[i] = add(pts[i], shift);
  }
  return pts;
}

/** Phase blend: full strength at the flagged moment, fading out over ~sigma seconds. */
export const phaseWeight = (t: number, tMoment: number, sigma = 0.35) => Math.exp(-((t - tMoment) ** 2) / (2 * sigma * sigma));

/** The "correct form" version of a whole rep. */
export function correctSequence(
  frames: readonly V3[][],
  times: readonly number[],
  corrections: readonly Correction[],
  tMoment: number,
  anchor: readonly number[] = [],
): V3[][] {
  return frames.map((f, i) => correctPose(f, corrections, 1, phaseWeight(times[i], tMoment), anchor));
}

/** Everything the viewer needs, prepared once. */
export interface Prepared3D {
  times: number[];
  you: V3[][];
  target: V3[][];
  floor: number;
  corrections: Correction[];
  faultJoints: number[];
  tMoment: number;
}

const FAULT_JOINTS: Record<string, number[]> = {
  shoulder_tilt: [LM.L_SHOULDER, LM.R_SHOULDER],
  body_sway: [LM.L_HIP, LM.R_HIP],
  chin_clearance: [LM.NOSE],
};

export function prepare3D(
  frames: readonly RepFrame[] | undefined,
  single: readonly Landmark[] | undefined,
  report: AngleReport,
  tMoment: number,
): Prepared3D | null {
  const seq = frames?.filter((f) => f.world?.length === 33) ?? [];
  const usable = seq.length >= 4 ? seq : single?.length === 33 ? [{ t: tMoment, world: [...single] }] : [];
  if (!usable.length) return null;
  const times = usable.map((f) => f.t);
  // World landmarks are hip-centred; re-anchor every frame on the contact points
  // (hands on the bar, feet on the floor) so the body moves and the contact stays put.
  const anchor = ANCHORS[report.exercise];
  const raw = smoothFrames(usable.map((f) => toScene(f.world)), 1);
  const centres = raw.map((f) => centroid(f, anchor));
  const home = scale(centres.reduce<V3>((a, c) => add(a, c), [0, 0, 0]), 1 / (centres.length || 1));
  const you = raw.map((f, i) => {
    const shift = sub(home, centres[i]);
    return f.map((p) => add(p, shift));
  });
  const corrections = correctionsFrom(report);
  const target = correctSequence(you, times, corrections, tMoment, ANCHORS[report.exercise]);
  const floor = floorOffset([...you, ...target]);
  const lift = (seqs: V3[][]) => seqs.map((f) => f.map((p) => [p[0], p[1] + floor, p[2]] as V3));
  const faultJoints = [
    ...new Set(
      report.violations.flatMap((v) => {
        const m = report.angles.find((a) => a.key === v.angleKey);
        return m?.points ? [m.points[1], mirrorIndex(m.points[1])] : (FAULT_JOINTS[v.angleKey] ?? []);
      }),
    ),
  ];
  return { times, you: lift(you), target: lift(target), floor, corrections, faultJoints, tMoment };
}

export const exerciseCameraHint: Record<ExerciseId, "front" | "side"> = {
  squat: "side",
  bench_press: "side",
  deadlift: "side",
  overhead_press: "side",
  biceps_curl: "side",
  pull_up: "front",
};
