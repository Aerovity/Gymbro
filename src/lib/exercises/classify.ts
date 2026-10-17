// Exercise auto-detect from a few poses (used when the user picks "Auto" and the video model can't
// say). Only the offered exercises: push_up | pull_up. Pure, client + server safe.
import type { ExerciseId, PoseResult, Pt } from "../types";
import { LM, VISIBILITY_MIN } from "../pose/landmarks";
import { dist, inclinationFromVertical, mid } from "../angles/math";
import { px, visibilityOf } from "../angles/view";

export interface ExerciseGuess {
  exercise: ExerciseId;
  /** 0–1. ≥ 0.75 = clear; below ~0.6 the caller should let the user confirm. */
  confidence: number;
  /** Short human reason, e.g. "body horizontal, hands on the floor". */
  reason: string;
}

/** Torso more than this far from vertical (degrees, pixel space) = horizontal body → push-up. */
export const HORIZONTAL_MIN_DEG = 55;
/** Torso within this of vertical = upright / hanging body. */
export const VERTICAL_MAX_DEG = 35;
/** Angled push-up: 3D torso (world landmarks) at least this far from vertical… */
export const ANGLED_MIN_3D_DEG = 40;
/** …or the on-screen torso at least this far (when there are no world landmarks). */
export const ANGLED_MIN_PX_DEG = 30;

export interface FrameFeatures {
  /** Mid-hip → mid-shoulder inclination from vertical in pixels (0 = upright, 90 = horizontal). */
  torsoIncl: number | null;
  handsAboveHead: boolean | null;
  handsAboveShoulders: boolean | null;
  handsBelowShoulders: boolean | null;
  /** Torso much shorter than the shoulder width on screen: body points at the camera (front-view push-up). */
  torsoForeshortened: boolean | null;
  /** Same torso inclination from the 3D world landmarks (camera axes; robust to a body pointing away from the camera). */
  torsoIncl3d: number | null;
  /** Wrists below (+) / above (−) the shoulders in 3D, in torso lengths (world landmarks; estimated even when occluded). */
  wristDrop3d: number | null;
}

const seen = (pose: PoseResult, i: number) => visibilityOf(pose, i) >= VISIBILITY_MIN;

/** Midpoint of the visible ones of two landmarks (one visible → that one). */
function midVisible(pose: PoseResult, a: number, b: number): Pt | null {
  const va = seen(pose, a);
  const vb = seen(pose, b);
  if (va && vb) return mid(px(pose, a), px(pose, b));
  if (va) return px(pose, a);
  if (vb) return px(pose, b);
  return null;
}

/** Per-frame features (all in pixels, so portrait/landscape aspect is handled). */
export function frameFeatures(pose: PoseResult): FrameFeatures {
  const none: FrameFeatures = {
    torsoIncl: null,
    handsAboveHead: null,
    handsAboveShoulders: null,
    handsBelowShoulders: null,
    torsoForeshortened: null,
    torsoIncl3d: null,
    wristDrop3d: null,
  };
  if (!pose?.landmarks || pose.landmarks.length < 33) return none;
  const sh = midVisible(pose, LM.L_SHOULDER, LM.R_SHOULDER);
  const hip = midVisible(pose, LM.L_HIP, LM.R_HIP);
  const torso = sh && hip ? dist(sh, hip) : null;
  const torsoIncl = sh && hip ? inclinationFromVertical(hip, sh) : null;

  const wristYs = [LM.L_WRIST, LM.R_WRIST].filter((i) => seen(pose, i)).map((i) => px(pose, i).y);
  const wristY = wristYs.length ? wristYs.reduce((a, b) => a + b, 0) / wristYs.length : null;
  const headPt = seen(pose, LM.NOSE) ? px(pose, LM.NOSE) : midVisible(pose, LM.L_EAR, LM.R_EAR);
  const margin = torso !== null && Number.isFinite(torso) ? torso * 0.1 : 0;

  const bothShoulders = seen(pose, LM.L_SHOULDER) && seen(pose, LM.R_SHOULDER);
  const bothHips = seen(pose, LM.L_HIP) && seen(pose, LM.R_HIP);
  const shoulderW = bothShoulders ? dist(px(pose, LM.L_SHOULDER), px(pose, LM.R_SHOULDER)) : null;

  return {
    torsoIncl,
    handsAboveHead: wristY !== null && headPt ? wristY < headPt.y : null,
    handsAboveShoulders: wristY !== null && sh ? wristY < sh.y - margin : null,
    handsBelowShoulders: wristY !== null && sh ? wristY > sh.y + margin : null,
    torsoForeshortened:
      torso !== null && shoulderW !== null && bothHips && shoulderW > 1 ? torso / shoulderW < 0.6 : null,
    ...world3d(pose),
  };
}

/** 3D torso inclination and wrist height from the world landmarks (metres, y down, camera-aligned). */
function world3d(pose: PoseResult): Pick<FrameFeatures, "torsoIncl3d" | "wristDrop3d"> {
  const w = pose.worldLandmarks;
  if (!w || w.length < 33) return { torsoIncl3d: null, wristDrop3d: null };
  const avg = (a: number, b: number) => ({ x: (w[a].x + w[b].x) / 2, y: (w[a].y + w[b].y) / 2, z: (w[a].z + w[b].z) / 2 });
  const sh = avg(LM.L_SHOULDER, LM.R_SHOULDER);
  const hip = avg(LM.L_HIP, LM.R_HIP);
  const wr = avg(LM.L_WRIST, LM.R_WRIST);
  const v = { x: sh.x - hip.x, y: sh.y - hip.y, z: sh.z - hip.z };
  const len = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(len) || len < 1e-3) return { torsoIncl3d: null, wristDrop3d: null };
  const incl = (Math.acos(Math.min(1, Math.abs(v.y) / len)) * 180) / Math.PI;
  const drop = (wr.y - sh.y) / len;
  return { torsoIncl3d: incl, wristDrop3d: Number.isFinite(drop) ? drop : null };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Share of frames where the flag is true, among frames where it could be measured (null = never). */
function share(flags: (boolean | null)[]): number | null {
  const known = flags.filter((f): f is boolean => f !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Push-up or pull-up from median per-frame features:
 * - torso > 55° from vertical (horizontal body) → push-up;
 * - torso near vertical with the hands above the shoulders/head in most frames → pull-up;
 * - torso pointing at the camera with the hands below the shoulders → push-up filmed from the front;
 * - 3D torso leaning ≥ 40° with the hands below the shoulders → push-up filmed at an angle (e.g. from behind);
 * - otherwise the nearest features win, at lower confidence.
 */
export function classifyExercise(poses: readonly PoseResult[]): ExerciseGuess {
  const feats = poses.filter(Boolean).map(frameFeatures);
  const incl = median(feats.map((f) => f.torsoIncl).filter((v): v is number => v !== null && Number.isFinite(v)));
  const above = share(feats.map((f) => f.handsAboveShoulders));
  const aboveHead = share(feats.map((f) => f.handsAboveHead));
  const below = share(feats.map((f) => f.handsBelowShoulders));
  const short = share(feats.map((f) => f.torsoForeshortened));
  const incl3d = median(feats.map((f) => f.torsoIncl3d).filter((v): v is number => v !== null && Number.isFinite(v)));
  const drop3d = median(feats.map((f) => f.wristDrop3d).filter((v): v is number => v !== null && Number.isFinite(v)));

  if (incl === null && above === null && below === null) {
    return { exercise: "push_up", confidence: 0.1, reason: "couldn't see enough of the body to tell" };
  }

  // Horizontal body.
  if (incl !== null && incl > HORIZONTAL_MIN_DEG) {
    const handsDown = (below ?? 0) >= 0.5;
    const handsUp = (above ?? 0) >= 0.5;
    const confidence = clamp01(0.75 + 0.15 * clamp01((incl - HORIZONTAL_MIN_DEG) / 25) + (handsDown ? 0.07 : 0) - (handsUp ? 0.25 : 0));
    return { exercise: "push_up", confidence: r2(confidence), reason: handsDown ? "body horizontal, hands on the floor" : "body horizontal" };
  }

  // Upright body hanging from the hands.
  const hanging = Math.max(above ?? 0, aboveHead ?? 0);
  if ((incl === null || incl <= VERTICAL_MAX_DEG) && hanging >= 0.6) {
    const confidence = clamp01(
      0.75 + (incl !== null ? 0.12 * clamp01((VERTICAL_MAX_DEG - incl) / 25) : 0) + ((aboveHead ?? 0) >= 0.5 ? 0.08 : 0),
    );
    return {
      exercise: "pull_up",
      confidence: r2(confidence),
      reason: (aboveHead ?? 0) >= 0.5 ? "hanging from a bar, hands above head" : "hanging from a bar, hands above the shoulders",
    };
  }

  // Front-view push-up: the torso points at the camera, hands planted below the shoulders.
  if ((below ?? 0) >= 0.6 && (short ?? 0) >= 0.5) {
    return { exercise: "push_up", confidence: 0.72, reason: "body pointing at the camera, hands on the floor" };
  }

  // Angled push-up (e.g. filmed from behind at ~45°): the body only looks half-tilted on screen, but the 3D
  // torso leans well away from vertical and the hands stay below the shoulders. Calibrated on a real clip:
  // pixel torso 31–48°, 3D torso 40–61° (median 54°), wrists 0.4–0.95 torso lengths below the shoulders;
  // the real pull-up clip reads 3D torso ~5°, wrists ~0.7 torso lengths ABOVE the shoulders.
  if (
    ((incl3d ?? 0) >= ANGLED_MIN_3D_DEG || (incl ?? 0) >= ANGLED_MIN_PX_DEG) &&
    (above ?? 0) <= 0.2 &&
    ((below ?? 0) >= 0.6 || (drop3d ?? -1) >= 0.3)
  ) {
    const lean = incl3d ?? incl ?? ANGLED_MIN_3D_DEG;
    const confidence = clamp01(0.62 + 0.1 * clamp01((lean - ANGLED_MIN_3D_DEG) / 20) + ((below ?? 0) >= 0.8 ? 0.06 : 0) + ((drop3d ?? 0) >= 0.4 ? 0.04 : 0));
    return { exercise: "push_up", confidence: r2(confidence), reason: "body leaning toward the floor, hands below the shoulders" };
  }

  // Nearest features, lower confidence.
  const evidence = (incl !== null ? (incl - 45) / 45 : 0) + (below ?? 0) - Math.max(above ?? 0, aboveHead ?? 0);
  const confidence = r2(Math.min(0.6, 0.35 + 0.25 * clamp01(Math.abs(evidence))));
  if (evidence > 0) {
    return {
      exercise: "push_up",
      confidence,
      reason: (below ?? 0) >= 0.5 ? "hands below the shoulders, likely on the floor" : "body leaning toward horizontal",
    };
  }
  return {
    exercise: "pull_up",
    confidence,
    reason: hanging >= 0.5 ? "hands above the shoulders, likely on a bar" : "body upright",
  };
}
