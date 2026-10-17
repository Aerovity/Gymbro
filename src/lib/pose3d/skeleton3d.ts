// 3D pose maths for the mannequin viewer (pure, no three.js / DOM).
// MediaPipe worldLandmarks are metres, hip-centred, x → subject's left-to-right in image,
// y DOWN, z toward the camera is negative. Scene space is y UP, so we flip y and z.
import type { AngleReport, ExerciseId, Landmark } from "../types";
import { LM } from "../pose/landmarks";
import { subtree, mirrorIndex } from "../angles/ghost";
import { rootNearZero } from "../angles/math";

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

/** Largest pitch (degrees) levelFloorContacts will correct. */
export const MAX_LEVEL_DEG = 60;

/**
 * Push-ups: MediaPipe world landmarks follow the camera, so a plank filmed by a phone tilted down
 * (e.g. from behind at ~45°) comes out as an incline. Hands and feet are both on the floor, so rotate
 * the whole rep about the horizontal axis until the mean feet → hands vector is level.
 */
export function levelFloorContacts(frames: readonly V3[][]): V3[][] {
  if (!frames.length) return [];
  const feet = (f: readonly V3[]) => mid3(f[LM.L_FOOT] ?? f[LM.L_ANKLE], f[LM.R_FOOT] ?? f[LM.R_ANKLE]);
  const hands = (f: readonly V3[]) => mid3(f[LM.L_WRIST], f[LM.R_WRIST]);
  let v: V3 = [0, 0, 0];
  let pivot: V3 = [0, 0, 0];
  for (const f of frames) {
    v = add(v, sub(hands(f), feet(f)));
    pivot = add(pivot, feet(f));
  }
  v = scale(v, 1 / frames.length);
  pivot = scale(pivot, 1 / frames.length);
  const flat: V3 = [v[0], 0, v[2]];
  const L = len(v);
  const Lf = len(flat);
  if (!(L > 1e-3) || !(Lf > 1e-3)) return frames.map((f) => f.map((p) => [...p] as V3));
  const rad = Math.acos(Math.min(1, Math.max(-1, dot(v, flat) / (L * Lf))));
  const axis = cross(v, flat);
  if (rad * DEG < 2 || rad * DEG > MAX_LEVEL_DEG || len(axis) < 1e-9) return frames.map((f) => f.map((p) => [...p] as V3));
  return frames.map((f) => f.map((p) => rotateAboutAxis(p, pivot, axis, rad)));
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
  | { kind: "straighten-knees"; key: string; ideal: number; local: boolean }
  /** Push-up plank: hips (and knees) onto the shoulder→ankle line. Hands and feet stay put. */
  | { kind: "body-line"; key: string; local: boolean }
  /**
   * Push-up elbow depth ("bottom", from elbow_bottom) or lockout ("top", from elbow_top): the rigid
   * body pivots about the toes with the hands fixed until the elbows reach the goal angle.
   * `ref` (elbow angle at the other end of the rep) and `at` (angle at the moment) are filled in by
   * correctSequence so the whole rep's range is rescaled instead of only the flagged frame.
   */
  | { kind: "push-depth"; key: string; ideal: number; phase: "bottom" | "top"; local: boolean; ref?: number; at?: number }
  /** Push-up elbow flare (front view): swing each elbow about its shoulder→wrist axis toward `ideal`. */
  | { kind: "elbow-tuck"; key: string; max?: number; ideal: number; local: boolean };

/**
 * Turns the measured violations of the chosen moment into 3D corrections.
 * `local` = the rule only applies at the flagged phase (blend in/out around the moment).
 */
export function correctionsFrom(report: AngleReport): Correction[] {
  const out: Correction[] = [];
  const push = report.exercise === "push_up";
  for (const v of report.violations) {
    const m = report.angles.find((a) => a.key === v.angleKey);
    if (push && (v.angleKey === "body_line" || v.angleKey === "hip_offset")) {
      if (!out.some((c) => c.kind === "body-line")) out.push({ kind: "body-line", key: v.angleKey, local: false });
      continue;
    }
    if (push && (v.angleKey === "elbow_bottom" || v.angleKey === "elbow_top")) {
      out.push({ kind: "push-depth", key: v.angleKey, ideal: v.target.ideal, phase: v.angleKey === "elbow_bottom" ? "bottom" : "top", local: true });
      continue;
    }
    if (push && v.angleKey === "elbow_flare") {
      out.push({ kind: "elbow-tuck", key: v.angleKey, max: v.target.max, ideal: v.target.ideal, local: true });
      continue;
    }
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

// ───────────── push-up corrections ─────────────

const ARMS: [number, number, number][] = [
  [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
];
const HAND_PTS = [LM.L_WRIST, LM.R_WRIST, LM.L_PINKY, LM.R_PINKY, LM.L_INDEX, LM.R_INDEX, LM.L_THUMB, LM.R_THUMB];
const TOES = [LM.L_FOOT, LM.R_FOOT];
const LINE_SIDES: [number, number, number, number][] = [
  [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
  [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
];

/** Mean 3D elbow angle of both arms (null if neither is measurable). */
export function pushElbowAngle(pts: readonly V3[]): number | null {
  const vals = ARMS.map(([s, e, w]) => (pts[s] && pts[e] && pts[w] ? angle3(pts[s], pts[e], pts[w]) : null)).filter(
    (v): v is number => v !== null,
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Perpendicular offset of the hip from the shoulder→ankle line, as a fraction of the shoulder–hip length (3D, per side, max). */
export function bodyLineOffset(pts: readonly V3[]): number {
  let worst = 0;
  for (const [s, h, , a] of LINE_SIDES) {
    const u = sub(pts[a], pts[s]);
    const L2 = dot(u, u);
    const torso = len(sub(pts[h], pts[s]));
    if (L2 < 1e-12 || torso < 1e-9) continue;
    const t = dot(sub(pts[h], pts[s]), u) / L2;
    worst = Math.max(worst, len(sub(pts[h], add(pts[s], scale(u, t)))) / torso);
  }
  return worst;
}

/** Move hips and knees toward the shoulder→ankle line by fraction w (1 = a straight plank). */
export function straightenBodyLine(pts: V3[], w: number) {
  for (const [s, h, k, a] of LINE_SIDES) {
    const S = pts[s];
    const u = sub(pts[a], S);
    const L2 = dot(u, u);
    if (L2 < 1e-12) continue;
    for (const i of [h, k]) {
      const p = pts[i];
      const onLine = add(S, scale(u, dot(sub(p, S), u) / L2));
      pts[i] = add(p, scale(sub(onLine, p), w));
    }
  }
}

/** Two-bone IK: elbow at distance a from S and b from W, on the side of `hint`. */
export function solveElbow(S: V3, W: V3, hint: V3, a: number, b: number): V3 {
  const sw = sub(W, S);
  const d0 = len(sw);
  if (d0 < 1e-9) return [...hint] as V3;
  const u = scale(sw, 1 / d0);
  const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, d0));
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(a * a - x * x, 0));
  const rel = sub(hint, S);
  let p = sub(rel, scale(u, dot(rel, u)));
  if (len(p) < 1e-9) p = cross(u, [0, 0, 1]);
  if (len(p) < 1e-9) p = cross(u, [1, 0, 0]);
  return add(S, add(scale(u, x), scale(p, h / len(p))));
}

/**
 * Push-up arms to `target` (mean elbow angle, degrees): the rigid body pivots about the toes so the
 * shoulders sit at the right distance from the hands, the hands stay planted and the elbows are
 * re-solved with their original segment lengths. Returns false when the geometry is degenerate.
 */
export function setPushupElbow(pts: V3[], target: number): boolean {
  const rad = (Math.min(179, Math.max(20, target)) * Math.PI) / 180;
  const segs = ARMS.map(([s, e, w]) => {
    const a = len(sub(pts[e], pts[s]));
    const b = len(sub(pts[w], pts[e]));
    // Shoulder–wrist distance that gives this arm the target elbow angle (law of cosines).
    return { s, e, w, a, b, want: Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(rad))) };
  });
  if (segs.some((g) => g.a < 1e-6 || g.b < 1e-6)) return false;
  const pivot = mid3(pts[LM.L_FOOT], pts[LM.R_FOOT]);
  const S0 = mid3(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
  const horiz: V3 = [S0[0] - pivot[0], 0, S0[2] - pivot[2]];
  if (len(horiz) < 1e-6) return false;
  // Horizontal axis across the body through the toes: +phi raises the shoulders.
  const axis = cross(horiz, [0, 1, 0]);
  const f = (phi: number) =>
    segs.reduce((acc, g) => acc + len(sub(rotateAboutAxis(pts[g.s], pivot, axis, phi), pts[g.w])) - g.want, 0) / segs.length;
  const phi = rootNearZero(f, 0.6); // ≤ ≈34°, more than any real push-up needs
  if (Math.abs(phi) < 1e-9) return true;
  const hands = new Set<number>(HAND_PTS);
  const toes = TOES.map((i) => [...pts[i]] as V3);
  for (let i = 0; i < pts.length; i++) if (!hands.has(i)) pts[i] = rotateAboutAxis(pts[i], pivot, axis, phi);
  TOES.forEach((i, k) => (pts[i] = toes[k]));
  for (const g of segs) pts[g.e] = solveElbow(pts[g.s], pts[g.w], pts[g.e], g.a, g.b);
  return true;
}

/** Swing each elbow about its shoulder→wrist axis (hands and shoulders fixed) toward the flare `goal`. */
function tuckElbows(pts: V3[], c: Extract<Correction, { kind: "elbow-tuck" }>, s: number) {
  for (const [sh, el, wr, hip] of [
    [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST, LM.L_HIP],
    [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST, LM.R_HIP],
  ] as const) {
    const cur = angle3(pts[el], pts[sh], pts[hip]);
    if (cur === null || (c.max !== undefined && cur <= c.max) || cur <= c.ideal) continue;
    const goal = cur + (c.ideal - cur) * s;
    const axis = sub(pts[wr], pts[sh]);
    if (len(axis) < 1e-9) continue;
    const E0 = pts[el];
    const flareAt = (rad: number) => angle3(rotateAboutAxis(E0, pts[sh], axis, rad), pts[sh], pts[hip]) ?? cur;
    let best = 0;
    let bestErr = Math.abs(cur - goal);
    for (let k = -36; k <= 36; k++) {
      const rad = (k * 5 * Math.PI) / 180;
      const err = Math.abs(flareAt(rad) - goal);
      if (err < bestErr - 1e-9) {
        best = rad;
        bestErr = err;
      }
    }
    for (let k = -10; k <= 10; k++) {
      const rad = best + (k * 0.5 * Math.PI) / 180;
      const err = Math.abs(flareAt(rad) - goal);
      if (err < bestErr - 1e-9) {
        best = rad;
        bestErr = err;
      }
    }
    pts[el] = rotateAboutAxis(E0, pts[sh], axis, best);
  }
}

/** Elbow angle the push-depth correction aims for on this frame (null = leave it). */
function pushGoal(c: Extract<Correction, { kind: "push-depth" }>, cur: number): { goal: number; ranged: boolean } | null {
  const deepen = c.phase === "bottom";
  let goal: number;
  let ranged = false;
  if (c.ref !== undefined && c.at !== undefined && Math.abs(c.at - c.ref) > 5) {
    // Rescale the rep's range: the far end (ref) stays, the flagged moment (at) lands on the ideal.
    goal = c.ref + (cur - c.ref) * ((c.ideal - c.ref) / (c.at - c.ref));
    ranged = true;
  } else {
    if (deepen ? cur <= c.ideal : cur >= c.ideal) return null;
    goal = c.ideal;
  }
  goal = deepen ? Math.min(goal, cur) : Math.max(goal, cur);
  return { goal: Math.min(178, Math.max(30, goal)), ranged };
}

/** What stays fixed in the world when the form is corrected (hands on the bar, feet on the floor…). */
export const ANCHORS: Record<ExerciseId, number[]> = {
  push_up: [LM.L_WRIST, LM.R_WRIST, LM.L_FOOT, LM.R_FOOT],
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
    } else if (c.kind === "body-line") {
      straightenBodyLine(pts, s);
    } else if (c.kind === "push-depth") {
      const cur = pushElbowAngle(pts);
      const g = cur === null ? null : pushGoal(c, cur);
      if (cur === null || !g) continue;
      // A rescaled range is already phase-aware (top frames map to themselves) → full strength.
      const target = cur + (g.goal - cur) * (g.ranged ? w : s);
      if (Math.abs(target - cur) > 0.25) setPushupElbow(pts, target);
    } else if (c.kind === "elbow-tuck") {
      tuckElbows(pts, c, s);
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
  const ranged = corrections.map((c) => (c.kind === "push-depth" ? withRepRange(c, frames, times, tMoment) : c));
  return frames.map((f, i) => correctPose(f, ranged, 1, phaseWeight(times[i], tMoment), anchor));
}

/** Fill in the push-depth range: ref = elbow angle at the other end of the rep, at = angle at the moment. */
function withRepRange(
  c: Extract<Correction, { kind: "push-depth" }>,
  frames: readonly V3[][],
  times: readonly number[],
  tMoment: number,
): Correction {
  if (frames.length < 3) return c;
  const angles = frames.map((f) => pushElbowAngle(f));
  const valid = angles.filter((v): v is number => v !== null);
  if (valid.length < 3) return c;
  let k = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - tMoment) < Math.abs(times[k] - tMoment)) k = i;
  const at = angles[k];
  if (at === null) return c;
  return { ...c, ref: c.phase === "bottom" ? Math.max(...valid) : Math.min(...valid), at };
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

/** Joints highlighted for a faulty metric (takes precedence over the metric's arc vertex). */
export const FAULT_JOINTS: Record<string, number[]> = {
  shoulder_tilt: [LM.L_SHOULDER, LM.R_SHOULDER],
  body_sway: [LM.L_HIP, LM.R_HIP],
  chin_clearance: [LM.NOSE],
  body_line: [LM.L_HIP, LM.R_HIP],
  hip_offset: [LM.L_HIP, LM.R_HIP],
  head_line: [LM.L_EAR, LM.R_EAR, LM.L_SHOULDER, LM.R_SHOULDER],
  elbow_bottom: [LM.L_ELBOW, LM.R_ELBOW],
  elbow_top: [LM.L_ELBOW, LM.R_ELBOW],
  elbow_flare: [LM.L_ELBOW, LM.R_ELBOW],
};

/** Highlighted joints for the report's violations. */
export function faultJoints(report: AngleReport): number[] {
  return [
    ...new Set(
      report.violations.flatMap((v) => {
        if (FAULT_JOINTS[v.angleKey]) return FAULT_JOINTS[v.angleKey];
        const m = report.angles.find((a) => a.key === v.angleKey);
        return m?.points ? [m.points[1], mirrorIndex(m.points[1])] : [];
      }),
    ),
  ];
}

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
  const smoothed = smoothFrames(usable.map((f) => toScene(f.world)), 1);
  const raw = report.exercise === "push_up" ? levelFloorContacts(smoothed) : smoothed;
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
  return { times, you: lift(you), target: lift(target), floor, corrections, faultJoints: faultJoints(report), tMoment };
}

export const exerciseCameraHint: Record<ExerciseId, "front" | "side"> = {
  squat: "side",
  bench_press: "side",
  deadlift: "side",
  overhead_press: "side",
  biceps_curl: "side",
  pull_up: "front",
  push_up: "side",
};
