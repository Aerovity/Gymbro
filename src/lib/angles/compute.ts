// Measures every metric of an exercise on one pose and turns it into an AngleReport (spec §7.6–7.8).
import type {
  AngleMeasurement,
  AngleReport,
  ExerciseId,
  PoseResult,
  Pt,
  RuleViolation,
  Side,
  View,
} from "../types";
import { LM, SIDE } from "../pose/landmarks";
import { EXERCISE_INFO } from "../exercises/catalog";
import {
  RULES,
  evaluate,
  inferPhase,
  severityFor,
  type ExerciseRule,
  type Phase,
} from "../exercises/rules";
import { formScore } from "../exercises/score";
import { angleAt, angleAt3, dist, inclinationFromVertical, lineTiltFromHorizontal, mid, round } from "./math";
import { chooseSide, detectView, isVisible, px } from "./view";

type LR = "left" | "right";

export interface MetricCtx {
  pose: PoseResult;
  side: LR;
  view: View;
}

/** Raw measurement before rule evaluation. */
export interface MetricResult {
  value: number | null;
  points?: [number, number, number];
  /** Landmarks that must be visible (≥0.5) for the value to be reliable. */
  used: number[];
  reliable?: boolean; // overrides the visibility check (e.g. "both" metrics with one visible side)
  note?: string;
}

export interface MetricDef {
  label: string;
  /** Mode for side handling. "near" = the chosen side; "both" = symmetric, worse side or combined. */
  mode: "near" | "both";
  /** For joint metrics with points: value equals the interior angle ("interior") or 180 − interior ("supplement"). */
  pointsMeaning?: "interior" | "supplement";
  compute: (ctx: MetricCtx) => MetricResult;
}

const P = (pose: PoseResult, i: number): Pt => px(pose, i);
const S = (s: LR) => SIDE[s];

function joint(pose: PoseResult, idx: [number, number, number]): number | null {
  return angleAt(P(pose, idx[0]), P(pose, idx[1]), P(pose, idx[2]));
}

function hasWorld(pose: PoseResult, idx: number[]): boolean {
  const w = pose.worldLandmarks;
  return (
    Array.isArray(w) &&
    w.length >= 33 &&
    idx.every((i) => w[i] && [w[i].x, w[i].y, w[i].z].every(Number.isFinite)) &&
    idx.some((i) => w[i].x !== 0 || w[i].y !== 0 || w[i].z !== 0)
  );
}

/** Near-side joint angle. */
function nearJoint(chain: (s: LR) => [number, number, number]): MetricDef["compute"] {
  return ({ pose, side }) => {
    const idx = chain(side);
    return { value: joint(pose, idx), points: idx, used: idx };
  };
}

/**
 * Symmetric joint metric: evaluates both sides, keeps the visible ones and returns the worse
 * ("max" = larger value is worse, "min" = smaller is worse). One visible side is enough.
 */
function worseJoint(
  chain: (s: LR) => [number, number, number],
  worse: "max" | "min",
  measure: (pose: PoseResult, idx: [number, number, number]) => number | null = joint,
  withPoints = true,
): MetricDef["compute"] {
  return ({ pose }) => {
    const cand = (["left", "right"] as const)
      .map((s) => ({ idx: chain(s), vis: isVisible(pose, chain(s)) }))
      .map((c) => ({ ...c, value: measure(pose, c.idx) }))
      .filter((c) => c.value !== null);
    const visible = cand.filter((c) => c.vis);
    const pool = visible.length ? visible : cand;
    if (!pool.length) return { value: null, used: [...chain("left"), ...chain("right")], reliable: false };
    pool.sort((a, b) => (worse === "max" ? b.value! - a.value! : a.value! - b.value!));
    const best = pool[0];
    return {
      value: best.value,
      ...(withPoints ? { points: best.idx } : {}),
      used: best.idx,
      reliable: visible.length > 0,
    };
  };
}

/** Signed forward lean of hip→shoulder from vertical (positive = toward the toes). */
function signedLean(pose: PoseResult, s: LR): number | null {
  const hip = P(pose, S(s).hip);
  const sh = P(pose, S(s).shoulder);
  const incl = inclinationFromVertical(hip, sh);
  if (incl === null) return null;
  const heel = P(pose, S(s).heel);
  const toe = P(pose, S(s).foot);
  let facing = Math.sign(toe.x - heel.x);
  if (!facing) facing = Math.sign(P(pose, LM.NOSE).x - P(pose, S(s).ear).x) || 1;
  const dir = Math.sign(sh.x - hip.x);
  return dir === 0 || dir === facing ? incl : -incl;
}

const midOf = (pose: PoseResult, a: number, b: number) => mid(P(pose, a), P(pose, b));
const torsoLen = (pose: PoseResult) =>
  dist(midOf(pose, LM.L_SHOULDER, LM.R_SHOULDER), midOf(pose, LM.L_HIP, LM.R_HIP));
const BOTH_SH_HIP = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
const BOTH_WRISTS = [LM.L_WRIST, LM.R_WRIST];

const elbowChain = (s: LR): [number, number, number] => [S(s).shoulder, S(s).elbow, S(s).wrist];
const kneeChain = (s: LR): [number, number, number] => [S(s).hip, S(s).knee, S(s).ankle];
const hipChain = (s: LR): [number, number, number] => [S(s).shoulder, S(s).hip, S(s).knee];
const flareChain = (s: LR): [number, number, number] => [S(s).elbow, S(s).shoulder, S(s).hip];

const ratio = (num: number, den: number) => (Number.isFinite(num) && Number.isFinite(den) && den > 1e-6 ? num / den : null);

const nearTorsoLean: MetricDef["compute"] = ({ pose, side }) => {
  const used = [S(side).hip, S(side).shoulder];
  return { value: inclinationFromVertical(P(pose, used[0]), P(pose, used[1])), used };
};

const nearLeanBack: MetricDef["compute"] = ({ pose, side }) => {
  const lean = signedLean(pose, side);
  return { value: lean === null ? null : -lean, used: [S(side).hip, S(side).shoulder, S(side).heel, S(side).foot] };
};

const nearElbow: MetricDef = { label: "Elbow angle", mode: "near", pointsMeaning: "interior", compute: nearJoint(elbowChain) };

/** All metric definitions per exercise, keyed by angleKey. */
export const METRICS: Record<ExerciseId, Record<string, MetricDef>> = {
  squat: {
    knee_angle: { label: "Knee angle", mode: "near", pointsMeaning: "interior", compute: nearJoint(kneeChain) },
    hip_depth: {
      label: "Hip depth (vs knee, thigh lengths)",
      mode: "near",
      compute: ({ pose, side }) => {
        const hip = P(pose, S(side).hip);
        const knee = P(pose, S(side).knee);
        return { value: ratio(hip.y - knee.y, dist(hip, knee)), used: [S(side).hip, S(side).knee] };
      },
    },
    trunk_tibia: {
      label: "Trunk–tibia angle",
      mode: "near",
      compute: ({ pose, side }) => {
        const c = S(side);
        const torso = inclinationFromVertical(P(pose, c.hip), P(pose, c.shoulder));
        const tibia = inclinationFromVertical(P(pose, c.ankle), P(pose, c.knee));
        return {
          value: torso === null || tibia === null ? null : torso - tibia,
          used: [c.hip, c.shoulder, c.knee, c.ankle],
        };
      },
    },
    torso_lean: { label: "Torso lean from vertical", mode: "near", compute: nearTorsoLean },
    knee_ankle_width: {
      label: "Knee width / ankle width",
      mode: "both",
      compute: ({ pose }) => {
        const kw = Math.abs(P(pose, LM.L_KNEE).x - P(pose, LM.R_KNEE).x);
        const aw = Math.abs(P(pose, LM.L_ANKLE).x - P(pose, LM.R_ANKLE).x);
        return { value: ratio(kw, aw), used: [LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE] };
      },
    },
    heel_lift: {
      label: "Heel lift (image heights)",
      mode: "near",
      compute: ({ pose, side }) => {
        const c = S(side);
        return {
          value: ratio(P(pose, c.foot).y - P(pose, c.heel).y, pose.height),
          used: [c.heel, c.foot],
        };
      },
    },
  },
  bench_press: {
    elbow_flare: {
      label: "Elbow flare (shoulder abduction)",
      mode: "both",
      pointsMeaning: "interior",
      compute: worseJoint(flareChain, "max", (pose, idx) => {
        if (hasWorld(pose, idx)) {
          const w = pose.worldLandmarks;
          return angleAt3(w[idx[0]], w[idx[1]], w[idx[2]]);
        }
        return joint(pose, idx);
      }),
    },
    forearm_vertical: {
      label: "Forearm from vertical",
      mode: "near",
      compute: ({ pose, side }) => {
        const c = S(side);
        return { value: inclinationFromVertical(P(pose, c.elbow), P(pose, c.wrist)), used: [c.elbow, c.wrist] };
      },
    },
    wrist_stack: {
      label: "Forearm from vertical (front)",
      mode: "both",
      compute: worseJoint(
        (s) => [S(s).elbow, S(s).wrist, S(s).wrist],
        "max",
        (pose, idx) => inclinationFromVertical(P(pose, idx[0]), P(pose, idx[1])),
        false,
      ),
    },
  },
  deadlift: {
    back_angle: {
      label: "Back angle from horizontal",
      mode: "near",
      compute: (ctx) => {
        const r = nearTorsoLean(ctx);
        return { ...r, value: r.value === null ? null : 90 - r.value };
      },
    },
    bar_path: {
      label: "Wrist offset from mid-foot (foot lengths)",
      mode: "near",
      compute: ({ pose, side }) => {
        const c = S(side);
        const heel = P(pose, c.heel);
        const toe = P(pose, c.foot);
        const midFoot = mid(heel, toe);
        return {
          value: ratio(Math.abs(P(pose, c.wrist).x - midFoot.x), dist(heel, toe)),
          used: [c.wrist, c.heel, c.foot],
        };
      },
    },
    hip_angle: { label: "Hip angle", mode: "near", pointsMeaning: "interior", compute: nearJoint(hipChain) },
    torso_lean_back: { label: "Lean back from vertical", mode: "near", compute: nearLeanBack },
    back_rounding: {
      label: "Back rounding proxy (neck vs torso)",
      mode: "near",
      pointsMeaning: "supplement",
      compute: ({ pose, side }) => {
        const idx: [number, number, number] = [S(side).ear, S(side).shoulder, S(side).hip];
        const a = joint(pose, idx);
        return { value: a === null ? null : 180 - a, points: idx, used: idx, note: "Pose can't see the spine — this is a proxy." };
      },
    },
  },
  overhead_press: {
    torso_lean_back: { label: "Lean back from vertical", mode: "near", compute: nearLeanBack },
    elbow_angle: nearElbow,
    wrist_over_shoulder: {
      label: "Wrist offset from shoulder (torso lengths)",
      mode: "near",
      compute: ({ pose, side }) => {
        const c = S(side);
        const sh = P(pose, c.shoulder);
        return {
          value: ratio(Math.abs(P(pose, c.wrist).x - sh.x), dist(sh, P(pose, c.hip))),
          used: [c.wrist, c.shoulder, c.hip],
        };
      },
    },
  },
  biceps_curl: {
    upper_arm_drift: {
      label: "Upper arm from vertical",
      mode: "near",
      compute: ({ pose, side }) => {
        const c = S(side);
        return { value: inclinationFromVertical(P(pose, c.shoulder), P(pose, c.elbow)), used: [c.shoulder, c.elbow] };
      },
    },
    torso_swing: { label: "Torso from vertical", mode: "near", compute: nearTorsoLean },
    elbow_angle: nearElbow,
  },
  pull_up: {
    elbow_top: { label: "Elbow angle", mode: "both", pointsMeaning: "interior", compute: worseJoint(elbowChain, "max") },
    chin_clearance: {
      label: "Chin above hands (torso lengths)",
      mode: "both",
      compute: ({ pose }) => {
        const wrists = midOf(pose, LM.L_WRIST, LM.R_WRIST);
        const T = torsoLen(pose);
        if (isVisible(pose, [LM.NOSE])) {
          return { value: ratio(wrists.y - P(pose, LM.NOSE).y, T), used: [LM.NOSE, ...BOTH_WRISTS, ...BOTH_SH_HIP] };
        }
        // Filmed from behind the nose is often hidden — the ears sit at roughly the same height.
        const ears = midOf(pose, LM.L_EAR, LM.R_EAR);
        return {
          value: ratio(wrists.y - ears.y, T),
          used: [LM.L_EAR, LM.R_EAR, ...BOTH_WRISTS, ...BOTH_SH_HIP],
          note: "Head height taken from the ears (face not visible).",
        };
      },
    },
    knee_angle: { label: "Knee angle", mode: "both", pointsMeaning: "interior", compute: worseJoint(kneeChain, "min") },
    shoulder_tilt: {
      label: "Shoulder line tilt",
      mode: "both",
      compute: ({ pose }) => ({
        value: lineTiltFromHorizontal(P(pose, LM.L_SHOULDER), P(pose, LM.R_SHOULDER)),
        used: [LM.L_SHOULDER, LM.R_SHOULDER],
      }),
    },
    elbow_asym: {
      label: "Left/right elbow difference",
      mode: "both",
      compute: ({ pose }) => {
        const l = joint(pose, elbowChain("left"));
        const r = joint(pose, elbowChain("right"));
        return { value: l === null || r === null ? null : Math.abs(l - r), used: [...elbowChain("left"), ...elbowChain("right")] };
      },
    },
    body_sway: {
      label: "Hips offset from hands (torso lengths)",
      mode: "both",
      compute: ({ pose }) => ({
        value: ratio(
          Math.abs(midOf(pose, LM.L_HIP, LM.R_HIP).x - midOf(pose, LM.L_WRIST, LM.R_WRIST).x),
          torsoLen(pose),
        ),
        used: [...BOTH_WRISTS, ...BOTH_SH_HIP],
      }),
    },
  },
};

export interface ComputeOptions {
  /** Override the detected view. */
  view?: View;
  /** Override the rep phase (default: inferred from the pose). */
  phase?: Exclude<Phase, "any">;
}

function viewAllowed(rule: ExerciseRule, view: View): boolean {
  if (rule.view === "any") return true;
  if (rule.view === "side") return view !== "front";
  return view !== "side";
}

function rulesFor(exercise: ExerciseId, phase: Exclude<Phase, "any">): ExerciseRule[] {
  return RULES[exercise].filter((r) => r.phase === "any" || r.phase === phase);
}

function resolveSide(pose: PoseResult, exercise: ExerciseId, view: View): Side {
  if (view === "front") return "both";
  if (view === "side") return chooseSide(pose);
  return EXERCISE_INFO[exercise].bestView === "front" ? "both" : chooseSide(pose);
}

/** Raw value of one metric (null when the key is unknown or the geometry is degenerate). Ignores visibility. */
export function computeMetric(pose: PoseResult, exercise: ExerciseId, key: string): number | null {
  const def = METRICS[exercise]?.[key];
  if (!def) return null;
  const view = detectView(pose).view;
  return def.compute({ pose, side: chooseSide(pose), view }).value;
}

function measure(rule: ExerciseRule, def: MetricDef | undefined, ctx: MetricCtx): AngleMeasurement {
  const decimals = rule.unit === "°" ? 1 : 3;
  const base = {
    key: rule.angleKey,
    label: def?.label ?? rule.label,
    unit: rule.unit,
    target: rule.target,
    ruleId: rule.id,
  };
  const unmeasurable = (note: string, points?: [number, number, number]): AngleMeasurement => ({
    ...base,
    ...(points ? { points } : {}),
    value: null,
    reliable: false,
    status: "unmeasurable",
    deviation: 0,
    note,
  });
  if (!def) return unmeasurable("No measurement for this metric.");
  if (!viewAllowed(rule, ctx.view)) {
    return unmeasurable(
      rule.view === "side"
        ? "Not measurable from this angle — film from the side."
        : "Not measurable from this angle — film from directly in front or behind.",
    );
  }
  const r = def.compute(ctx);
  const reliable = r.reliable ?? isVisible(ctx.pose, r.used);
  if (r.value === null || !Number.isFinite(r.value)) {
    return unmeasurable("Couldn't measure this — joints overlap or are out of frame.", r.points);
  }
  if (!reliable) {
    return unmeasurable("Joints not clearly visible (confidence < 0.5) — not scored.", r.points);
  }
  const value = round(r.value, decimals);
  const { status, deviation } = evaluate(value, rule.target, rule.devScale);
  const notes = [r.note, ctx.view === "angled" ? "Angled view: numbers ±10°." : undefined].filter(Boolean);
  return {
    ...base,
    ...(r.points ? { points: r.points } : {}),
    value,
    reliable: true,
    status,
    deviation: round(deviation, decimals),
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}

/** Full angle report for one pose: measure, gate (visibility ≥ 0.5 and view), evaluate, sort, score. */
export function computeAngleReport(pose: PoseResult, exercise: ExerciseId, opts: ComputeOptions = {}): AngleReport {
  const view = opts.view ?? detectView(pose).view;
  const phase = opts.phase ?? inferPhase(pose, exercise);
  const side = resolveSide(pose, exercise, view);
  const ctx: MetricCtx = { pose, view, side: side === "both" ? chooseSide(pose) : side };
  const rules = rulesFor(exercise, phase);
  const angles = rules.map((rule) => measure(rule, METRICS[exercise][rule.angleKey], ctx));

  const violations: (RuleViolation & { _scaled: number })[] = [];
  angles.forEach((m, i) => {
    const rule = rules[i];
    if (m.status === "unmeasurable" || m.value === null || m.deviation <= 0) return;
    violations.push({
      ruleId: rule.id,
      label: rule.label,
      angleKey: rule.angleKey,
      actual: m.value,
      target: rule.target,
      deviation: m.deviation,
      severity: severityFor(rule, m.deviation),
      cue: rule.cue,
      basis: rule.basis,
      ...(rule.citation ? { citation: rule.citation } : {}),
      _scaled: m.deviation * rule.devScale,
    });
  });
  violations.sort((a, b) => b.severity - a.severity || b._scaled - a._scaled);
  const { score, grade } = formScore(angles);
  return {
    exercise,
    view,
    side,
    angles,
    violations: violations.map(({ _scaled, ...v }) => {
      void _scaled;
      return v;
    }),
    score,
    grade,
  };
}
