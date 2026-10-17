// Verify the AI-corrected "after" image by re-measuring it (spec §8.4).
import type { AngleReport, ExerciseId, PoseResult, VerifyReport } from "../types";
import { LM } from "../pose/landmarks";
import { computeAngleReport } from "../angles/compute";
import { dist, mid, round } from "../angles/math";
import { px } from "../angles/view";
import { PRIMARY_KEY, findRule, inferPhase } from "./rules";

/** Tolerance (degree-equivalents) for "close enough" to the target. */
export const VERIFY_TOLERANCE = 10;
/** Identity drift above this suggests a regenerate. */
export const IDENTITY_DRIFT_WARN = 0.15;

function bodyDims(pose: PoseResult): { torso: number; shoulders: number } {
  const diag = Math.hypot(pose.width, pose.height) || 1;
  const ms = mid(px(pose, LM.L_SHOULDER), px(pose, LM.R_SHOULDER));
  const mh = mid(px(pose, LM.L_HIP), px(pose, LM.R_HIP));
  return {
    torso: dist(ms, mh) / diag,
    shoulders: dist(px(pose, LM.L_SHOULDER), px(pose, LM.R_SHOULDER)) / diag,
  };
}

/** 0–1 relative change in torso length / shoulder width, each normalised by its image diagonal. */
export function identityDrift(beforePose: PoseResult, afterPose: PoseResult): number {
  const a = bodyDims(beforePose);
  const b = bodyDims(afterPose);
  const rel = (x: number, y: number) => (x > 1e-6 && Number.isFinite(y) ? Math.abs(y / x - 1) : 0);
  const parts = [rel(a.torso, b.torso)];
  // Shoulder width is tiny (and noisy) in side view; only use it when meaningful.
  if (a.shoulders > 0.02) parts.push(rel(a.shoulders, b.shoulders));
  return round(Math.min(1, Math.max(...parts)), 3);
}

/**
 * Re-measure the after pose with the same phase as the before frame. The primary metric is the
 * before report's top violation (what the edit was asked to fix), or PRIMARY_KEY when nothing was flagged.
 */
export function verifyAfter(
  before: AngleReport,
  beforePose: PoseResult,
  afterPose: PoseResult,
  exercise: ExerciseId,
  attempts = 1,
): VerifyReport {
  const after = computeAngleReport(afterPose, exercise, { phase: inferPhase(beforePose, exercise), view: before.view });
  const primaryKey = before.violations[0]?.angleKey ?? PRIMARY_KEY[exercise];
  const b = before.angles.find((a) => a.key === primaryKey);
  const m = after.angles.find((a) => a.key === primaryKey);
  const primaryAfter = m && m.status !== "unmeasurable" ? m.value : null;
  const scale = findRule(m?.ruleId)?.devScale ?? 1;
  const passed = !!m && primaryAfter !== null && m.reliable && m.deviation * scale <= VERIFY_TOLERANCE;
  return {
    angles: after.angles,
    primaryKey,
    primaryBefore: b && b.status !== "unmeasurable" ? b.value : null,
    primaryAfter,
    passed,
    identityDrift: identityDrift(beforePose, afterPose),
    attempts,
  };
}
