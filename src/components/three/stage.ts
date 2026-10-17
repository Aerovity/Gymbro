// Pure staging maths for the 3D replay (no React, no three.js): the body's own frame, camera
// presets relative to it, where "you" and "target" stand, and a camera fit to the real 3D extent.
// Works for upright bodies (pull-up: hanging) and horizontal ones (push-up: plank on the floor).
import { LM } from "@/lib/pose/landmarks";
import type { Prepared3D, V3 } from "@/lib/pose3d/skeleton3d";
import type { ExerciseId } from "@/lib/types";

export type Layout = "split" | "overlay";
export type CamPreset = "front" | "side" | "34";
/** across = side by side on screen · stack = target on a raised plate above you (horizontal bodies). */
export type Arrangement = "overlay" | "across" | "stack";

export const FOV = 38; // vertical, degrees
const UP: V3 = [0, 1, 0];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const mid = (a: V3, b: V3): V3 => mul(add(a, b), 0.5);
/** Unit horizontal projection, or null when (nearly) vertical. */
function flat(v: V3): V3 | null {
  const l = Math.hypot(v[0], v[2]);
  return l > 1e-4 ? [v[0] / l, 0, v[2] / l] : null;
}

/** Landmarks that define the visible body (face reduced to nose + ears, hands to index tips). */
export const BODY_POINTS: readonly number[] = [
  LM.NOSE, LM.L_EAR, LM.R_EAR, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_INDEX, LM.R_INDEX, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
  LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT,
];

export interface BodyFrame {
  /** Horizontal unit: where the "front" camera sits (toward the head for horizontal bodies, toward the filming camera otherwise). */
  forward: V3;
  /** Horizontal unit: where the "side" camera sits (profile view; on the filming camera's side when possible). */
  side: V3;
  /** Horizontal unit along the shoulder line (left → right). */
  lateral: V3;
  /** Spine nearer horizontal than vertical (push-up, plank). */
  horizontal: boolean;
}

/** The body's own axes, averaged over the rep. Every degenerate case falls back to the scene axes. */
export function bodyFrame(frames: readonly V3[][]): BodyFrame {
  let spine: V3 = [0, 0, 0];
  let lat: V3 = [0, 0, 0];
  let vert = 0;
  let n = 0;
  for (const f of frames) {
    const s = sub(mid(f[LM.L_SHOULDER], f[LM.R_SHOULDER]), mid(f[LM.L_HIP], f[LM.R_HIP]));
    const l = len(s);
    if (l > 1e-6) {
      vert += Math.abs(s[1]) / l;
      n++;
    }
    spine = add(spine, s);
    lat = add(lat, add(sub(f[LM.R_SHOULDER], f[LM.L_SHOULDER]), sub(f[LM.R_HIP], f[LM.L_HIP])));
  }
  const horizontal = n > 0 && vert / n < 0.6; // spine within ~37° of the floor
  const latFlat = flat(lat);
  let forward: V3;
  if (horizontal) {
    // Front camera looks at the head: along the spine, toward the shoulders.
    forward = flat(spine) ?? (latFlat ? [-latFlat[2], 0, latFlat[0]] : [0, 0, 1]);
  } else {
    // Front camera faces the body square-on, on the side of the camera that filmed it.
    forward = latFlat ? [-latFlat[2], 0, latFlat[0]] : [0, 0, 1];
    if (forward[2] < -1e-6 || (Math.abs(forward[2]) <= 1e-6 && forward[0] < 0)) forward = mul(forward, -1);
  }
  let side: V3 = [forward[2], 0, -forward[0]];
  // Prefer the filming camera's side (+z), else +x (matches the original fixed presets).
  if (dot(side, [0.35, 0, 1]) < 0) side = mul(side, -1);
  return { forward, side, lateral: latFlat ?? side, horizontal };
}

/** Unit vector from the focus point to the camera for a preset. */
export function presetDir(preset: CamPreset, frame: BodyFrame): V3 {
  const elev = frame.horizontal ? { front: 0.55, side: 0.17, "34": 0.4 } : { front: 0.06, side: 0.06, "34": 0.16 };
  const h = preset === "front" ? frame.forward : preset === "side" ? frame.side : flat(add(frame.forward, frame.side)) ?? frame.side;
  const e = elev[preset];
  return [h[0] * Math.cos(e), Math.sin(e), h[2] * Math.cos(e)];
}

/** Camera right / up for a view direction (camera at focus + dir · d looking back at the focus). */
export function screenAxes(dir: V3): { right: V3; up: V3 } {
  const r = cross(UP, dir);
  const l = len(r);
  const right: V3 = l > 1e-6 ? mul(r, 1 / l) : [1, 0, 0];
  return { right, up: cross(dir, right) };
}

export interface BarProp {
  y: number;
  centre: V3;
  yaw: number;
  width: number;
}
export interface MatProp {
  centre: V3;
  yaw: number;
  length: number;
  width: number;
}

export interface StageModel {
  times: number[];
  you: V3[][];
  target: V3[][];
  faultJoints: number[];
  frame: BodyFrame;
  /** Highest point of either body (m above the floor). */
  top: number;
  bar: BarProp | null;
  mat: MatProp | null;
  /** Sampled points of each station (body over the whole rep + props), for framing and label placement. */
  cloudYou: V3[];
  cloudTarget: V3[];
}

const yawOf = (axis: V3) => Math.atan2(-axis[2], axis[0]);

/** Recentres the prepared rep on its footprint and derives props and the body frame. */
export function buildStage(prepared: Prepared3D, exercise: ExerciseId): StageModel {
  const all = [...prepared.you, ...prepared.target];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  for (const f of all)
    for (const i of BODY_POINTS) {
      const p = f[i];
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]);
      z1 = Math.max(z1, p[2]);
      top = Math.max(top, p[1]);
    }
  const cx = Number.isFinite(x0) ? (x0 + x1) / 2 : 0;
  const cz = Number.isFinite(z0) ? (z0 + z1) / 2 : 0;
  const shift = (seq: V3[][]) => seq.map((f) => f.map((p) => [p[0] - cx, p[1], p[2] - cz] as V3));
  const you = shift(prepared.you);
  const target = shift(prepared.target);
  const frame = bodyFrame(you);

  let bar: BarProp | null = null;
  let mat: MatProp | null = null;
  if (exercise === "pull_up") {
    let y = -Infinity;
    let c: V3 = [0, 0, 0];
    for (const f of you) {
      y = Math.max(y, f[LM.L_WRIST][1], f[LM.R_WRIST][1]);
      c = add(c, mid(f[LM.L_WRIST], f[LM.R_WRIST]));
    }
    c = mul(c, 1 / (you.length || 1));
    bar = { y: y + 0.035, centre: [c[0], 0, c[2]], yaw: yawOf(frame.lateral), width: 1.1 };
  } else {
    // Mat under whatever touches the floor (hands + toes for a push-up, feet otherwise).
    const along = frame.horizontal ? frame.forward : frame.lateral;
    const across: V3 = [along[2], 0, -along[0]];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const f of [...you, ...target])
      for (const i of BODY_POINTS) {
        const p = f[i];
        if (p[1] > 0.2) continue;
        const a = dot(p, along);
        const b = dot(p, across);
        a0 = Math.min(a0, a);
        a1 = Math.max(a1, a);
        b0 = Math.min(b0, b);
        b1 = Math.max(b1, b);
      }
    if (Number.isFinite(a0)) {
      const length = Math.max(a1 - a0 + 0.36, frame.horizontal ? 1.2 : 0.8);
      const width = Math.max(b1 - b0 + 0.18, 0.62);
      const centre = add(mul(along, (a0 + a1) / 2), mul(across, (b0 + b1) / 2));
      mat = { centre, yaw: yawOf(along), length, width };
    }
  }

  const props: V3[] = [];
  if (bar) {
    const half = mul(frame.lateral, bar.width / 2);
    props.push(add([bar.centre[0], bar.y, bar.centre[2]], half), sub([bar.centre[0], bar.y, bar.centre[2]], half));
  }
  if (mat) {
    const a: V3 = [Math.cos(mat.yaw), 0, -Math.sin(mat.yaw)];
    const b: V3 = [a[2], 0, -a[0]];
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) props.push(add(mat.centre, add(mul(a, (sa * mat.length) / 2), mul(b, (sb * mat.width) / 2))));
  }
  const cloud = (seq: V3[][]) => {
    const out: V3[] = [...props];
    const stride = Math.max(1, Math.floor(seq.length / 12));
    for (let k = 0; k < seq.length; k += stride) for (const i of BODY_POINTS) out.push(seq[k][i]);
    const last = seq[seq.length - 1];
    if (last) for (const i of BODY_POINTS) out.push(last[i]);
    return out;
  };
  return {
    times: prepared.times,
    you,
    target,
    faultJoints: prepared.faultJoints,
    frame,
    top,
    bar,
    mat,
    cloudYou: cloud(you),
    cloudTarget: cloud(target),
  };
}

/** Canvas size plus the pixels reserved at the top and bottom (HUD bars). */
export interface Viewport {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

export interface Plan {
  arrangement: Arrangement;
  you: V3;
  target: V3;
  dir: V3;
  focus: V3;
  position: V3;
  distance: number;
  /** Reserved pixels the fit honoured (HUD + name plate rows); the camera's view offset centres this band. */
  top: number;
  bottom: number;
  /** Radius of floor the stations need (stage disc). */
  floorRadius: number;
}

const PAD = 0.13; // mannequin thickness around the landmark cloud (m)
const PLATE_ROW = 46; // px kept free for a name plate row

/** Camera distance/focus that fits both stations into the reserved band of the viewport. */
function fit(clouds: { pts: readonly V3[]; off: V3 }[], dir: V3, vp: Viewport, top: number, bottom: number) {
  const { right, up } = screenAxes(dir);
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const { pts, off } of clouds)
    for (const p0 of pts) {
      const p = add(p0, off);
      const r = dot(p, right), u = dot(p, up), w = dot(p, dir);
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      w0 = Math.min(w0, w); w1 = Math.max(w1, w);
    }
  const rc = (r0 + r1) / 2, uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
  const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
  const aspect = vp.width / Math.max(vp.height, 1);
  const fh = Math.max(0.3, 1 - (top + bottom) / Math.max(vp.height, 1));
  const fw = Math.max(0.5, 1 - 28 / Math.max(vp.width, 1));
  // Exact per-point perspective fit around the band centre: a point nearer the camera needs more room.
  let distance = 0;
  for (const { pts, off } of clouds)
    for (const p0 of pts) {
      const p = add(p0, off);
      const dw = dot(p, dir) - wc;
      const needR = (Math.abs(dot(p, right) - rc) + PAD) / (tanV * aspect * fw);
      const needU = (Math.abs(dot(p, up) - uc) + PAD) / (tanV * fh);
      distance = Math.max(distance, Math.max(needR, needU) + dw + PAD);
    }
  distance = Math.max(distance * 1.04, 1.8);
  const focus = add(add(mul(right, rc), mul(up, uc)), mul(dir, wc));
  return { focus, distance, position: add(focus, mul(dir, distance)) };
}

function floorRadius(clouds: { pts: readonly V3[]; off: V3 }[]) {
  let r = 0;
  for (const { pts, off } of clouds) for (const p of pts) r = Math.max(r, Math.hypot(p[0] + off[0], p[2] + off[2]));
  return Math.max(2.4, r + 0.55);
}

/** Where everything goes for a layout + preset + viewport. Picks the split that shows the bodies biggest. */
export function planStage(model: StageModel, layout: Layout, preset: CamPreset, vp: Viewport): Plan {
  const dir = presetDir(preset, model.frame);
  const zero: V3 = [0, 0, 0];
  if (layout === "overlay") {
    const clouds = [{ pts: model.cloudYou, off: zero }, { pts: model.cloudTarget, off: zero }];
    const top = vp.top + 8, bottom = vp.bottom + PLATE_ROW;
    const f = fit(clouds, dir, vp, top, bottom);
    return { arrangement: "overlay", you: zero, target: zero, dir, ...f, top, bottom, floorRadius: floorRadius(clouds) };
  }
  const { right } = screenAxes(dir);
  // Across: separate along the screen's right axis by the body's projected width + a gap.
  let a0 = Infinity, a1 = -Infinity;
  for (const p of [...model.cloudYou, ...model.cloudTarget]) {
    const a = dot(p, right);
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
  }
  const sep = a1 - a0 + 2 * PAD + 0.12;
  const across = {
    you: mul(right, -sep / 2),
    target: mul(right, sep / 2),
    top: vp.top + 8,
    bottom: vp.bottom + PLATE_ROW,
  };
  const acrossClouds = [{ pts: model.cloudYou, off: across.you }, { pts: model.cloudTarget, off: across.target }];
  const acrossFit = fit(acrossClouds, dir, vp, across.top, across.bottom);
  let best: Plan = { arrangement: "across", you: across.you, target: across.target, dir, ...acrossFit, top: across.top, bottom: across.bottom, floorRadius: floorRadius(acrossClouds) };
  if (model.frame.horizontal) {
    // Stack: the target on a raised plate just above you (both still read in profile).
    const lift = model.top + 2 * PAD + 0.2;
    const stack = { you: zero, target: [0, lift, 0] as V3, top: vp.top + PLATE_ROW, bottom: vp.bottom + PLATE_ROW };
    const stackClouds = [{ pts: model.cloudYou, off: stack.you }, { pts: model.cloudTarget, off: stack.target }];
    const stackFit = fit(stackClouds, dir, vp, stack.top, stack.bottom);
    if (stackFit.distance < acrossFit.distance * 0.9) {
      best = { arrangement: "stack", you: stack.you, target: stack.target, dir, ...stackFit, top: stack.top, bottom: stack.bottom, floorRadius: floorRadius(stackClouds) };
    }
  }
  return best;
}
