// Form score (spec §7.8): 100 − Σ weight × min(deviation, 40) × 1.5, reliable angles only.
import type { AngleMeasurement, AngleReport } from "../types";
import { findRule } from "./rules";

export function gradeFor(score: number): AngleReport["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

export function formScore(angles: readonly AngleMeasurement[]): { score: number; grade: AngleReport["grade"] } {
  let penalty = 0;
  for (const a of angles) {
    if (!a.reliable || a.status === "unmeasurable" || a.value === null || !(a.deviation > 0)) continue;
    const rule = findRule(a.ruleId);
    const weight = rule?.weight ?? 1;
    const scale = rule?.devScale ?? (a.unit === "ratio" ? 100 : 1);
    penalty += weight * Math.min(a.deviation * scale, 40) * 1.5;
  }
  const score = Math.round(Math.max(0, Math.min(100, 100 - penalty)));
  return { score, grade: gradeFor(score) };
}
