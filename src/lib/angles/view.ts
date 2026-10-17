// View detection, side selection and visibility gating (spec §7.7).
import type { PoseResult, Pt, View } from "../types";
import { LM, SIDE, VISIBILITY_MIN } from "../pose/landmarks";
import { dist, mid, toPx } from "./math";

export const SIDE_MAX_RATIO = 0.35;
export const FRONT_MIN_RATIO = 0.6;

/** Pixel position of landmark `i`. */
export function px(pose: PoseResult, i: number): Pt {
  const lm = pose.landmarks[i];
  return lm ? toPx(lm, pose.width, pose.height) : { x: NaN, y: NaN };
}

export function visibilityOf(pose: PoseResult, i: number): number {
  const v = pose.landmarks[i]?.visibility;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** True when every listed landmark exists and has visibility ≥ 0.5. */
export function isVisible(pose: PoseResult, idx: readonly number[]): boolean {
  return idx.every((i) => visibilityOf(pose, i) >= VISIBILITY_MIN);
}

/** Pixel torso length: mid-shoulder → mid-hip. */
export function torsoLength(pose: PoseResult): number {
  const ms = mid(px(pose, LM.L_SHOULDER), px(pose, LM.R_SHOULDER));
  const mh = mid(px(pose, LM.L_HIP), px(pose, LM.R_HIP));
  return dist(ms, mh);
}

/**
 * Side vs front from the shoulder-width / torso-length ratio.
 * < 0.35 side, > 0.6 front (rear view looks identical, so "front" covers it), otherwise angled.
 */
export function detectView(pose: PoseResult): { view: View; shoulderWidthRatio: number } {
  const core = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
  if (pose.landmarks.length < 33 || core.every((i) => visibilityOf(pose, i) < VISIBILITY_MIN)) {
    return { view: "unknown", shoulderWidthRatio: 0 };
  }
  const torso = torsoLength(pose);
  const sw = Math.abs(px(pose, LM.L_SHOULDER).x - px(pose, LM.R_SHOULDER).x);
  if (!Number.isFinite(torso) || !Number.isFinite(sw) || torso < 1) {
    return { view: "unknown", shoulderWidthRatio: 0 };
  }
  const shoulderWidthRatio = sw / torso;
  const view: View =
    shoulderWidthRatio < SIDE_MAX_RATIO ? "side" : shoulderWidthRatio > FRONT_MIN_RATIO ? "front" : "angled";
  return { view, shoulderWidthRatio };
}

/** The more visible (near) side: higher mean visibility over shoulder, hip, knee and ankle. Ties → left. */
export function chooseSide(pose: PoseResult): "left" | "right" {
  const score = (s: "left" | "right") => {
    const c = SIDE[s];
    const idx = [c.shoulder, c.hip, c.knee, c.ankle];
    return idx.reduce((acc, i) => acc + visibilityOf(pose, i), 0) / idx.length;
  };
  return score("right") > score("left") ? "right" : "left";
}
