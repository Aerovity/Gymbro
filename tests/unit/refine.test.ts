import { describe, expect, it } from "vitest";
import type { AngleReport, RuleViolation } from "@/lib/types";
import { bodyPartFor, eventsFromReps, fmtClock, refineTimes, type RepTop } from "@/lib/moments/refine";
import { angleLabel, arcParams, normAngle } from "@/lib/render/drawOverlay";

const viol = (over: Partial<RuleViolation>): RuleViolation => ({
  ruleId: "pullup_top_elbow",
  label: "Elbow angle at top",
  angleKey: "elbow_top",
  actual: 95,
  target: { max: 75, ideal: 60 },
  deviation: 20,
  severity: 3,
  cue: "Pull your elbows down to your ribs — chin over the bar.",
  basis: "heuristic",
  ...over,
});
const rep = (t: number, violations: RuleViolation[]): RepTop => ({
  t,
  signal: 90,
  metrics: {},
  report: {
    exercise: "pull_up",
    view: "front",
    side: "both",
    angles: [{ key: "elbow_top", label: "Elbow", value: 95, unit: "°", reliable: true, status: "bad", deviation: 20 }],
    violations,
    score: 60,
    grade: "C",
  } satisfies AngleReport,
});

describe("refine helpers", () => {
  it("fmtClock", () => {
    expect(fmtClock(7.2)).toBe("0:07.2");
    expect(fmtClock(65.04)).toBe("1:05.0");
    expect(fmtClock(-1)).toBe("0:00.0");
  });
  it("refineTimes spans ±0.6 s at 10 fps and is clamped", () => {
    const ts = refineTimes(7.2, 15);
    expect(ts).toHaveLength(13);
    expect(ts[0]).toBeCloseTo(6.6);
    expect(ts[12]).toBeCloseTo(7.8);
    expect(ts).toContain(7.2);
    const edge = refineTimes(0.2, 15);
    expect(edge[0]).toBeCloseTo(0);
    expect(refineTimes(14.9, 15).every((t) => t <= 14.95)).toBe(true);
  });
  it("bodyPartFor", () => {
    expect(bodyPartFor("elbow_top")).toBe("arms");
    expect(bodyPartFor("chin_clearance")).toBe("head");
    expect(bodyPartFor("knee_angle")).toBe("legs");
    expect(bodyPartFor("body_sway")).toBe("torso");
    expect(bodyPartFor("xyz")).toBe("body");
  });
});

describe("eventsFromReps", () => {
  const times = [0, 15];
  it("returns the worst reps first, at most 3", () => {
    const reps = [
      rep(1, [viol({ severity: 2 })]),
      rep(3.5, [viol({ severity: 4, deviation: 25 })]),
      rep(6, []),
      rep(8.5, [viol({ severity: 4, deviation: 30, ruleId: "pullup_knee_kick", label: "Knee angle", angleKey: "knee_angle", actual: 120, target: { min: 150, ideal: 175 } })]),
      rep(11, [viol({ severity: 1 })]),
    ];
    const ev = eventsFromReps(reps, times);
    expect(ev.map((e) => e.t_peak)).toEqual([8.5, 3.5, 1]);
    expect(ev[0]).toMatchObject({ rep_index: 4, severity: 4, confidence: 0.6, issue: "Knee angle", body_part: "legs" });
    expect(ev[0].t_start).toBeCloseTo(7.25);
    expect(ev[0].t_end).toBeCloseTo(9.75);
    expect(ev[0].description).toContain("120°");
    expect(ev[0].description).toContain("≥150°");
  });
  it("falls back to one low-severity event when nothing is violated", () => {
    const ev = eventsFromReps([rep(2, []), rep(5, [])], times);
    expect(ev).toHaveLength(1);
    expect(ev[0].severity).toBe(1);
    expect(eventsFromReps([], times)).toEqual([]);
  });
});

describe("overlay geometry", () => {
  it("normAngle / arcParams", () => {
    expect(normAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    const a = arcParams({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(a.end - a.start).toBeCloseTo(Math.PI / 2);
    expect(a.ccw).toBe(false);
  });
  it("angleLabel", () => {
    expect(angleLabel({ value: 112.4, unit: "°", target: { max: 95, ideal: 90 } })).toBe("112° → ≤95°");
    expect(angleLabel({ value: 0.02, unit: "ratio", target: { min: 0.05, ideal: 0.15 } })).toBe("0.02 → ≥0.05");
    expect(angleLabel({ value: null, unit: "°" })).toBe("—");
  });
});
