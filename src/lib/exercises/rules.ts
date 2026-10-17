// Biomechanical rules and targets per exercise (spec §7.8 + pull-up from docs/BUILD.md).
// Literature-backed rules carry a citation; everything else is a "coaching guideline" (heuristic).
import type { ExerciseId, PoseResult, TargetRange, Verdict } from "../types";
import { SIDE } from "../pose/landmarks";
import { angleAt } from "../angles/math";
import { chooseSide, detectView, isVisible, px } from "../angles/view";

export type Phase = "bottom" | "top" | "lockout" | "setup" | "any";
export type RuleView = "side" | "front" | "any";

export interface ExerciseRule {
  id: string;
  label: string;
  angleKey: string;
  /** Camera view needed to measure it. "front" also covers rear view. */
  view: RuleView;
  /** Rep phase the rule applies to; "any" rules are always evaluated. */
  phase: Phase;
  target: TargetRange;
  unit: "°" | "ratio";
  cue: string;
  basis: "literature" | "heuristic";
  citation?: string;
  /** Score weight (spec §7.8 form score). */
  weight: number;
  /** Converts a raw deviation into degree-equivalents for severity/scoring (1 for degrees). */
  devScale: number;
  /** Optional ceiling on severity (e.g. the back-rounding proxy is low-confidence). */
  severityCap?: number;
}

const CIT = {
  caterisano:
    "Caterisano et al. 2002, J Strength Cond Res: parallel squat ≈ 90° knee flexion (as summarised in a ClinicalTrials.gov protocol)",
  ijspt:
    "IJSPT 2024 squat review: −10° ≤ trunk–tibia angle ≤ 10° = neutral bias; Frontiers 2024 scoping review rates 'trunk parallel to tibia' as good",
  bench:
    "Jacksonville Orthopaedic Institute technique guide (tuck elbows 45–75°); Frontiers in Physiology 2024 musculoskeletal model: 45° raised glenohumeral superior shear vs 70°",
} as const;

const R = (r: Omit<ExerciseRule, "weight" | "devScale"> & Partial<Pick<ExerciseRule, "weight" | "devScale">>): ExerciseRule => ({
  weight: 1,
  devScale: 1,
  ...r,
});

export const RULES: Record<ExerciseId, ExerciseRule[]> = {
  squat: [
    R({
      id: "squat_depth",
      label: "Knee angle (depth)",
      angleKey: "knee_angle",
      view: "side",
      phase: "bottom",
      target: { max: 90, ideal: 80 },
      unit: "°",
      cue: "Sit deeper — hips down until your thighs are at least parallel.",
      basis: "literature",
      citation: CIT.caterisano,
    }),
    R({
      id: "squat_hip_depth",
      label: "Hip depth vs knee",
      angleKey: "hip_depth",
      view: "side",
      phase: "bottom",
      // Hip crease at/below knee top, with ~6° tolerance for landmark placement (hip joint ≠ hip crease).
      target: { min: -0.1, ideal: 0.05 },
      unit: "ratio",
      cue: "Hip crease to knee height — break parallel.",
      basis: "heuristic",
      weight: 0.5,
      // ratio ≈ sin(thigh angle below horizontal) → ~57° per unit; capped, knee angle is the primary depth rule.
      devScale: 60,
      severityCap: 3,
    }),
    R({
      id: "squat_trunk_tibia",
      label: "Trunk–tibia angle",
      angleKey: "trunk_tibia",
      view: "side",
      phase: "bottom",
      target: { min: -10, max: 10, ideal: 0 },
      unit: "°",
      cue: "Chest up — keep your torso parallel to your shins.",
      basis: "literature",
      citation: CIT.ijspt,
    }),
    R({
      id: "squat_torso_lean",
      label: "Torso lean",
      angleKey: "torso_lean",
      view: "side",
      phase: "bottom",
      target: { max: 45, ideal: 35 },
      unit: "°",
      cue: "Proud chest, brace hard — don't fold forward.",
      basis: "heuristic",
      weight: 0.6,
    }),
    R({
      id: "squat_knee_cave",
      label: "Knee / ankle width",
      angleKey: "knee_ankle_width",
      view: "front",
      phase: "bottom",
      target: { min: 0.9, ideal: 1.05 },
      unit: "ratio",
      cue: "Spread the floor — knees out over your toes.",
      basis: "heuristic",
      devScale: 100,
    }),
    R({
      id: "squat_heel_lift",
      label: "Heel lift",
      angleKey: "heel_lift",
      view: "side",
      phase: "bottom",
      target: { max: 0.02, ideal: 0 },
      unit: "ratio",
      cue: "Whole foot planted — drive through your heels.",
      basis: "heuristic",
      weight: 0.6,
      devScale: 500,
    }),
  ],
  bench_press: [
    R({
      id: "bench_elbow_flare",
      label: "Elbow flare",
      angleKey: "elbow_flare",
      view: "front",
      phase: "bottom",
      target: { min: 45, max: 75, ideal: 60 },
      unit: "°",
      cue: "Tuck your elbows to about 60° and aim the bar at your lower sternum.",
      basis: "literature",
      citation: CIT.bench,
    }),
    R({
      id: "bench_forearm_vertical",
      label: "Forearm vs vertical",
      angleKey: "forearm_vertical",
      view: "side",
      phase: "bottom",
      target: { max: 15, ideal: 0 },
      unit: "°",
      cue: "Stack your forearms vertical under the bar.",
      basis: "heuristic",
      weight: 0.6,
    }),
    R({
      id: "bench_wrist_stack",
      label: "Wrist over elbow",
      angleKey: "wrist_stack",
      view: "front",
      phase: "bottom",
      target: { max: 15, ideal: 0 },
      unit: "°",
      cue: "Wrists straight and stacked over your elbows.",
      basis: "heuristic",
      weight: 0.6,
    }),
  ],
  deadlift: [
    R({
      id: "deadlift_back_angle",
      label: "Back angle at setup",
      angleKey: "back_angle",
      view: "side",
      phase: "setup",
      target: { min: 30, max: 60, ideal: 45 },
      unit: "°",
      cue: "Hips set between knees and shoulders — chest up, lats tight.",
      basis: "heuristic",
    }),
    R({
      id: "deadlift_bar_path",
      label: "Bar over mid-foot",
      angleKey: "bar_path",
      view: "side",
      phase: "any",
      target: { max: 0.1, ideal: 0 },
      unit: "ratio",
      cue: "Keep the bar dragging up your shins over mid-foot.",
      basis: "heuristic",
      weight: 0.6,
      devScale: 100,
    }),
    R({
      id: "deadlift_lockout",
      label: "Hip angle at lockout",
      angleKey: "hip_angle",
      view: "side",
      phase: "lockout",
      target: { min: 170, ideal: 178 },
      unit: "°",
      cue: "Squeeze your glutes to finish — stand tall.",
      basis: "heuristic",
    }),
    R({
      id: "deadlift_hyperextension",
      label: "Lean back at lockout",
      angleKey: "torso_lean_back",
      view: "side",
      phase: "lockout",
      target: { max: 5, ideal: 0 },
      unit: "°",
      cue: "Finish tall, don't lean back — ribs down.",
      basis: "heuristic",
      weight: 0.6,
    }),
    R({
      id: "deadlift_rounding",
      label: "Back rounding (proxy)",
      angleKey: "back_rounding",
      view: "side",
      phase: "any",
      target: { max: 25, ideal: 10 },
      unit: "°",
      cue: "Proud chest, long neck — pull the slack out before the bar moves.",
      basis: "heuristic",
      severityCap: 3,
    }),
  ],
  overhead_press: [
    R({
      id: "ohp_lean_back",
      label: "Lean back",
      angleKey: "torso_lean_back",
      view: "side",
      phase: "lockout",
      target: { max: 10, ideal: 0 },
      unit: "°",
      cue: "Ribs down, glutes tight — stack your torso under the bar.",
      basis: "heuristic",
    }),
    R({
      id: "ohp_elbow_lockout",
      label: "Elbow lockout",
      angleKey: "elbow_angle",
      view: "side",
      phase: "lockout",
      target: { min: 170, ideal: 178 },
      unit: "°",
      cue: "Punch the ceiling — lock those elbows out.",
      basis: "heuristic",
    }),
    R({
      id: "ohp_wrist_stack",
      label: "Bar over shoulders",
      angleKey: "wrist_over_shoulder",
      view: "side",
      phase: "lockout",
      target: { max: 0.08, ideal: 0 },
      unit: "ratio",
      cue: "Head through the window — bar right over your shoulders.",
      basis: "heuristic",
      weight: 0.6,
      devScale: 125,
    }),
  ],
  biceps_curl: [
    R({
      id: "curl_elbow_drift",
      label: "Upper-arm drift",
      angleKey: "upper_arm_drift",
      view: "side",
      phase: "any",
      target: { max: 15, ideal: 0 },
      unit: "°",
      cue: "Pin your elbows to your sides.",
      basis: "heuristic",
    }),
    R({
      id: "curl_torso_swing",
      label: "Torso swing",
      angleKey: "torso_swing",
      view: "side",
      phase: "any",
      target: { max: 10, ideal: 0 },
      unit: "°",
      cue: "Stand tall and still — no swinging the weight up.",
      basis: "heuristic",
    }),
    R({
      id: "curl_bottom_rom",
      label: "Elbow at bottom",
      angleKey: "elbow_angle",
      view: "side",
      phase: "bottom",
      target: { min: 150, ideal: 165 },
      unit: "°",
      cue: "Let the arm get long at the bottom of every rep.",
      basis: "heuristic",
      weight: 0.6,
    }),
    R({
      id: "curl_top_rom",
      label: "Elbow at top",
      angleKey: "elbow_angle",
      view: "side",
      phase: "top",
      target: { max: 50, ideal: 40 },
      unit: "°",
      cue: "Curl all the way up — squeeze at the top.",
      basis: "heuristic",
      weight: 0.6,
    }),
  ],
  pull_up: [
    R({
      id: "pullup_top_elbow",
      label: "Elbow angle at top",
      angleKey: "elbow_top",
      // BUILD.md lists "front"; elbow angle is equally measurable from the side, so "any".
      view: "any",
      phase: "top",
      target: { max: 75, ideal: 60 },
      unit: "°",
      cue: "Pull your elbows down to your ribs — chin over the bar.",
      basis: "heuristic",
    }),
    R({
      id: "pullup_chin_clear",
      label: "Chin clearance",
      angleKey: "chin_clearance",
      view: "front",
      phase: "top",
      target: { min: 0.05, ideal: 0.15 },
      unit: "ratio",
      cue: "Drive the chin past the bar every rep.",
      basis: "heuristic",
      devScale: 100,
    }),
    R({
      id: "pullup_knee_kick",
      label: "Knee angle",
      angleKey: "knee_angle",
      view: "any",
      phase: "any",
      target: { min: 150, ideal: 175 },
      unit: "°",
      cue: "Squeeze glutes, legs long — no kicking.",
      basis: "heuristic",
    }),
    R({
      id: "pullup_shoulder_level",
      label: "Shoulder tilt",
      angleKey: "shoulder_tilt",
      view: "front",
      phase: "any",
      target: { max: 6, ideal: 0 },
      unit: "°",
      cue: "Pull evenly — both elbows down together.",
      basis: "heuristic",
      // Small angles matter here: a 10° tilt is a big left/right imbalance on a hang.
      devScale: 3,
    }),
    R({
      id: "pullup_elbow_sym",
      label: "Elbow symmetry",
      angleKey: "elbow_asym",
      view: "front",
      phase: "any",
      target: { max: 15, ideal: 0 },
      unit: "°",
      cue: "Match both arms.",
      basis: "heuristic",
      weight: 0.8,
      devScale: 2,
    }),
    R({
      id: "pullup_sway",
      label: "Body sway",
      angleKey: "body_sway",
      view: "front",
      phase: "any",
      target: { max: 0.25, ideal: 0 },
      unit: "ratio",
      cue: "Brace your core, stay still under the bar.",
      basis: "heuristic",
      weight: 0.6,
      devScale: 100,
    }),
  ],
};

/** The metric the image edit and verification focus on when nothing else is flagged. */
export const PRIMARY_KEY: Record<ExerciseId, string> = {
  squat: "knee_angle",
  bench_press: "elbow_flare",
  deadlift: "back_rounding",
  overhead_press: "torso_lean_back",
  biceps_curl: "upper_arm_drift",
  pull_up: "elbow_top",
};

export function findRule(ruleId: string | undefined): ExerciseRule | undefined {
  if (!ruleId) return undefined;
  for (const list of Object.values(RULES)) {
    const r = list.find((x) => x.id === ruleId);
    if (r) return r;
  }
  return undefined;
}

// ───────────── Phase locator (used by refinement) ─────────────

type Joint = "elbow" | "knee" | "hip";
const CHAIN: Record<Joint, (s: "left" | "right") => [number, number, number]> = {
  elbow: (s) => [SIDE[s].shoulder, SIDE[s].elbow, SIDE[s].wrist],
  knee: (s) => [SIDE[s].hip, SIDE[s].knee, SIDE[s].ankle],
  hip: (s) => [SIDE[s].shoulder, SIDE[s].hip, SIDE[s].knee],
};

function sideAngle(pose: PoseResult, joint: Joint, s: "left" | "right"): number | null {
  const idx = CHAIN[joint](s);
  if (!isVisible(pose, idx)) return null;
  return angleAt(px(pose, idx[0]), px(pose, idx[1]), px(pose, idx[2]));
}

/** Mean of the visible sides' joint angle (front/angled view), or the near side's (side view). */
export function jointSignal(pose: PoseResult, joint: Joint): number | null {
  if (detectView(pose).view === "side") {
    const near = sideAngle(pose, joint, chooseSide(pose));
    if (near !== null) return near;
  }
  const vals = (["left", "right"] as const)
    .map((s) => sideAngle(pose, joint, s))
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export interface PhaseLocator {
  phase: Exclude<Phase, "any">;
  extremum: "min" | "max";
  signal: (pose: PoseResult) => number | null;
}

export const PHASE: Record<ExerciseId, PhaseLocator> = {
  squat: { phase: "bottom", extremum: "min", signal: (p) => jointSignal(p, "knee") },
  bench_press: { phase: "bottom", extremum: "min", signal: (p) => jointSignal(p, "elbow") },
  deadlift: { phase: "lockout", extremum: "max", signal: (p) => jointSignal(p, "hip") },
  overhead_press: { phase: "lockout", extremum: "max", signal: (p) => jointSignal(p, "elbow") },
  biceps_curl: { phase: "top", extremum: "min", signal: (p) => jointSignal(p, "elbow") },
  pull_up: { phase: "top", extremum: "min", signal: (p) => jointSignal(p, "elbow") },
};

/**
 * Which phase a single frame shows. Exercises whose phase rules all share one phase use PHASE[ex].phase.
 * Deadlift and curl have two phased rule sets, so the frame's joint angle decides.
 */
export function inferPhase(pose: PoseResult, exercise: ExerciseId): Exclude<Phase, "any"> {
  if (exercise === "deadlift") {
    const hip = jointSignal(pose, "hip");
    return hip !== null && hip < 150 ? "setup" : "lockout";
  }
  if (exercise === "biceps_curl") {
    const elbow = jointSignal(pose, "elbow");
    return elbow !== null && elbow >= 100 ? "bottom" : "top";
  }
  return PHASE[exercise].phase;
}

// ───────────── Evaluation ─────────────

/** Severity 1 (≤5°), 2 (≤10°), 3 (≤20°), 4 (≤30°), 5 (>30°). Deviation in degree-equivalents. */
export function severityFromDeviation(d: number): number {
  if (d <= 5) return 1;
  if (d <= 10) return 2;
  if (d <= 20) return 3;
  if (d <= 30) return 4;
  return 5;
}

export function severityFor(rule: ExerciseRule, deviation: number): number {
  const s = severityFromDeviation(deviation * rule.devScale);
  return rule.severityCap ? Math.min(s, rule.severityCap) : s;
}

/** Distance outside [min, max]. Borderline = within 5 degree-equivalents (deviation × scale). */
export function evaluate(
  value: number,
  target: TargetRange,
  scale = 1,
): { status: Exclude<Verdict, "unmeasurable">; deviation: number } {
  let deviation = 0;
  if (target.min !== undefined && value < target.min) deviation = target.min - value;
  else if (target.max !== undefined && value > target.max) deviation = value - target.max;
  const scaled = deviation * scale;
  const status = deviation <= 0 ? "good" : scaled <= 5 ? "borderline" : "bad";
  return { status, deviation };
}
