import { describe, expect, it } from "vitest";
import {
  PHASE,
  PRIMARY_KEY,
  RULES,
  evaluate,
  findRule,
  inferPhase,
  jointSignal,
  severityFor,
  severityFromDeviation,
} from "@/lib/exercises/rules";
import { formScore, gradeFor } from "@/lib/exercises/score";
import { computeAngleReport } from "@/lib/angles/compute";
import { EXERCISES, type AngleMeasurement } from "@/lib/types";
import { LM } from "@/lib/pose/landmarks";
import { makePose, pullUp, sideSquat, withVisibility } from "../helpers/pose";

describe("rule table", () => {
  it("every exercise has rules with complete metadata", () => {
    for (const ex of EXERCISES) {
      expect(RULES[ex].length).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const r of RULES[ex]) {
        expect(r.id).toBeTruthy();
        expect(ids.has(r.id)).toBe(false);
        ids.add(r.id);
        expect(r.label).toBeTruthy();
        expect(r.angleKey).toMatch(/^[a-z_]+$/);
        expect(["side", "front", "any"]).toContain(r.view);
        expect(["bottom", "top", "lockout", "setup", "any"]).toContain(r.phase);
        expect(r.target.min !== undefined || r.target.max !== undefined).toBe(true);
        if (r.target.min !== undefined) expect(r.target.ideal).toBeGreaterThanOrEqual(r.target.min);
        if (r.target.max !== undefined) expect(r.target.ideal).toBeLessThanOrEqual(r.target.max);
        expect(["°", "ratio"]).toContain(r.unit);
        expect(r.cue.length).toBeGreaterThan(5);
        expect(["literature", "heuristic"]).toContain(r.basis);
        if (r.basis === "literature") expect(r.citation).toBeTruthy();
        expect(r.weight).toBeGreaterThan(0);
        expect(r.devScale).toBeGreaterThan(0);
      }
      expect(PRIMARY_KEY[ex]).toBeTruthy();
      expect(RULES[ex].some((r) => r.angleKey === PRIMARY_KEY[ex])).toBe(true);
      expect(PHASE[ex].phase).toBeTruthy();
    }
  });
  it("pull-up rules match the BUILD.md table", () => {
    const byId = Object.fromEntries(RULES.pull_up.map((r) => [r.id, r]));
    expect(byId.pullup_top_elbow).toMatchObject({ angleKey: "elbow_top", phase: "top", target: { max: 75, ideal: 60 } });
    expect(byId.pullup_chin_clear).toMatchObject({ angleKey: "chin_clearance", unit: "ratio", target: { min: 0.05, ideal: 0.15 } });
    expect(byId.pullup_knee_kick).toMatchObject({ angleKey: "knee_angle", phase: "any", target: { min: 150, ideal: 175 } });
    expect(byId.pullup_shoulder_level).toMatchObject({ angleKey: "shoulder_tilt", target: { max: 6, ideal: 0 } });
    expect(byId.pullup_elbow_sym).toMatchObject({ angleKey: "elbow_asym", target: { max: 15, ideal: 0 } });
    expect(byId.pullup_sway).toMatchObject({ angleKey: "body_sway", target: { max: 0.25, ideal: 0 } });
    expect(RULES.pull_up.every((r) => r.basis === "heuristic")).toBe(true);
    expect(byId.pullup_top_elbow.cue).toBe("Pull your elbows down to your ribs — chin over the bar.");
  });
  it("squat never has a knees-over-toes rule", () => {
    expect(RULES.squat.some((r) => /toe/i.test(r.id + r.angleKey + r.label))).toBe(false);
  });
  it("findRule", () => {
    expect(findRule("pullup_sway")?.angleKey).toBe("body_sway");
    expect(findRule("nope")).toBeUndefined();
    expect(findRule(undefined)).toBeUndefined();
  });
});

describe("severity buckets", () => {
  it.each([
    [0, 1],
    [5, 1],
    [5.01, 2],
    [10, 2],
    [15, 3],
    [20, 3],
    [25, 4],
    [30, 4],
    [30.1, 5],
    [90, 5],
  ])("deviation %s → severity %s", (d, s) => {
    expect(severityFromDeviation(d)).toBe(s);
  });
  it("ratio rules scale deviation and caps apply", () => {
    const chin = findRule("pullup_chin_clear")!;
    expect(severityFor(chin, 0.2)).toBe(3); // 20 degree-equivalents
    const round = findRule("deadlift_rounding")!;
    expect(severityFor(round, 60)).toBe(3);
  });
});

describe("evaluate", () => {
  it("inside → good, ≤5 outside → borderline, beyond → bad", () => {
    expect(evaluate(60, { min: 45, max: 75, ideal: 60 })).toEqual({ status: "good", deviation: 0 });
    expect(evaluate(78, { min: 45, max: 75, ideal: 60 })).toEqual({ status: "borderline", deviation: 3 });
    expect(evaluate(85, { min: 45, max: 75, ideal: 60 })).toEqual({ status: "bad", deviation: 10 });
    expect(evaluate(30, { min: 45, max: 75, ideal: 60 })).toEqual({ status: "bad", deviation: 15 });
    expect(evaluate(0.04, { min: 0.05, ideal: 0.15 }, 100).status).toBe("borderline");
    expect(evaluate(-0.2, { min: 0.05, ideal: 0.15 }, 100).status).toBe("bad");
  });
});

describe("form score", () => {
  const m = (deviation: number, ruleId = "squat_depth", extra: Partial<AngleMeasurement> = {}): AngleMeasurement => ({
    key: "k",
    label: "k",
    value: 100,
    unit: "°",
    reliable: true,
    status: deviation > 0 ? "bad" : "good",
    deviation,
    ruleId,
    ...extra,
  });
  it("is monotonic decreasing with deviation", () => {
    let prev = Infinity;
    for (let d = 0; d <= 60; d += 2) {
      const { score } = formScore([m(d)]);
      expect(score).toBeLessThanOrEqual(prev);
      prev = score;
    }
    expect(formScore([m(0)]).score).toBe(100);
    expect(formScore([m(10)]).score).toBe(85);
    expect(formScore([m(40)]).score).toBe(40);
    expect(formScore([m(80)]).score).toBe(40); // capped at 40°
  });
  it("is clamped to [0, 100] and weights apply", () => {
    expect(formScore([m(40), m(40), m(40)]).score).toBe(0);
    expect(formScore([m(10, "squat_torso_lean")]).score).toBe(91); // weight 0.6
    expect(formScore([m(10, "unknown_rule")]).score).toBe(85);
    expect(formScore([m(0.1, "unknown_rule", { unit: "ratio" })]).score).toBe(85);
  });
  it("excludes unreliable / unmeasurable angles", () => {
    expect(formScore([m(30, "squat_depth", { reliable: false })]).score).toBe(100);
    expect(formScore([m(30, "squat_depth", { status: "unmeasurable" })]).score).toBe(100);
    expect(formScore([m(30, "squat_depth", { value: null })]).score).toBe(100);
  });
  it("grades", () => {
    expect(gradeFor(100)).toBe("A");
    expect(gradeFor(85)).toBe("A");
    expect(gradeFor(84)).toBe("B");
    expect(gradeFor(70)).toBe("B");
    expect(gradeFor(69)).toBe("C");
    expect(gradeFor(55)).toBe("C");
    expect(gradeFor(54)).toBe("D");
  });
  it("unreliable angles are excluded from report scores", () => {
    const pose = sideSquat({ knee: 120, tibia: 25, torso: 30 });
    const all = computeAngleReport(pose, "squat");
    const hidden = computeAngleReport(withVisibility(pose, [LM.L_KNEE, LM.R_KNEE, LM.L_HIP, LM.R_HIP], 0.1), "squat");
    expect(all.score).toBeLessThan(100);
    expect(hidden.violations).toEqual([]);
    expect(hidden.score).toBe(100);
  });
});

describe("phase locator", () => {
  it("pull-up: top found at min mean elbow angle", () => {
    expect(PHASE.pull_up).toMatchObject({ phase: "top", extremum: "min" });
    const top = PHASE.pull_up.signal(pullUp({ elbowL: 60 }))!;
    const hang = PHASE.pull_up.signal(pullUp({ elbowL: 170 }))!;
    expect(top).toBeCloseTo(60, 0);
    expect(hang).toBeCloseTo(170, 0);
    expect(PHASE.pull_up.signal(pullUp({ elbowL: 60, elbowR: 100 }))!).toBeCloseTo(80, 0);
  });
  it("documented phases and extrema", () => {
    expect(PHASE.squat).toMatchObject({ phase: "bottom", extremum: "min" });
    expect(PHASE.bench_press).toMatchObject({ phase: "bottom", extremum: "min" });
    expect(PHASE.deadlift).toMatchObject({ phase: "lockout", extremum: "max" });
    expect(PHASE.overhead_press).toMatchObject({ phase: "lockout", extremum: "max" });
    expect(PHASE.biceps_curl).toMatchObject({ phase: "top", extremum: "min" });
  });
  it("squat signal uses the near knee in side view", () => {
    expect(PHASE.squat.signal(sideSquat({ knee: 95, tibia: 20, torso: 30 }))!).toBeCloseTo(95, 0);
  });
  it("signals return null when joints are hidden; other signals are finite", () => {
    const p = withVisibility(makePose({}), [LM.L_ELBOW, LM.R_ELBOW], 0.1);
    expect(PHASE.pull_up.signal(p)).toBeNull();
    expect(jointSignal(makePose({}), "hip")).toBeGreaterThan(150);
    for (const ex of EXERCISES) expect(Number.isFinite(PHASE[ex].signal(makePose({}))!)).toBe(true);
  });
  it("inferPhase: deadlift and curl decide by angle; others fixed", () => {
    expect(inferPhase(makePose({}), "deadlift")).toBe("lockout");
    expect(inferPhase(sideSquat({ knee: 90, tibia: 20, torso: 60 }), "deadlift")).toBe("setup");
    expect(inferPhase(makePose({}), "biceps_curl")).toBe("bottom");
    expect(inferPhase(pullUp({ elbowL: 60 }), "biceps_curl")).toBe("top");
    expect(inferPhase(makePose({}), "pull_up")).toBe("top");
    expect(inferPhase(makePose({}), "squat")).toBe("bottom");
  });
});
