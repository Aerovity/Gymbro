import { describe, expect, it } from "vitest";
import { issueMatchesRules, pickMoment, scoreEvent } from "@/lib/moments/pick";
import type { ScanEvent } from "@/lib/types";

const ev = (o: Partial<ScanEvent>): ScanEvent => ({
  t_start: 4,
  t_peak: 5,
  t_end: 6,
  issue: "something_odd",
  body_part: "body",
  severity: 3,
  confidence: 0.5,
  description: "",
  ...o,
});

describe("scoreEvent", () => {
  it("follows the §7.3 formula", () => {
    // 3*0.6 + 0.5*5*0.3 = 2.55, mid-clip +0.2
    expect(scoreEvent(ev({}), { duration: 10 })).toBeCloseTo(2.75, 9);
    // rule match +0.5
    expect(scoreEvent(ev({ issue: "partial_range" }), { duration: 10, exercise: "pull_up" })).toBeCloseTo(3.25, 9);
    // not mid-clip
    expect(scoreEvent(ev({ t_peak: 1 }), { duration: 10 })).toBeCloseTo(2.55, 9);
  });
  it("edge penalty within 0.3 s of either end", () => {
    expect(scoreEvent(ev({ t_peak: 0.2 }), { duration: 10 })).toBeCloseTo(2.05, 9);
    expect(scoreEvent(ev({ t_peak: 9.8 }), { duration: 10 })).toBeCloseTo(2.05, 9);
    expect(scoreEvent(ev({ t_peak: 0.31 }), { duration: 10 })).toBeCloseTo(2.55, 9);
  });
  it("tolerates non-finite numbers", () => {
    expect(scoreEvent(ev({ severity: NaN, confidence: NaN, t_peak: 2 }), { duration: 10 })).toBe(0);
  });
});

describe("issueMatchesRules", () => {
  it("matches exercise-specific vocabulary", () => {
    expect(issueMatchesRules(ev({ issue: "knee_kick" }), "pull_up")).toBe(true);
    expect(issueMatchesRules(ev({ issue: "chin-not-over-bar" }), "pull_up")).toBe(true);
    expect(issueMatchesRules(ev({ issue: "elbow_flare" }), "bench_press")).toBe(true);
    expect(issueMatchesRules(ev({ issue: "insufficient_depth" }), "squat")).toBe(true);
    expect(issueMatchesRules(ev({ issue: "weird", body_part: "aura" }), "squat")).toBe(false);
    expect(issueMatchesRules(ev({ issue: "elbow" }), undefined)).toBe(false);
  });
});

describe("pickMoment", () => {
  it("chooses the highest-scoring event", () => {
    const a = ev({ severity: 3, t_peak: 5 });
    const b = ev({ severity: 5, t_peak: 6, issue: "partial_range" });
    const c = ev({ severity: 4, t_peak: 7 });
    expect(pickMoment([a, b, c], { duration: 15, exercise: "pull_up" })).toBe(b);
  });
  it("edge penalty can flip the choice", () => {
    const edge = ev({ severity: 4, t_peak: 0.1, confidence: 0.5 });
    const mid = ev({ severity: 4, t_peak: 5, confidence: 0.4 });
    expect(pickMoment([edge, mid], { duration: 10 })).toBe(mid);
  });
  it("rule match beats an unrelated issue of equal severity", () => {
    const unrelated = ev({ issue: "bad_vibes", body_part: "aura" });
    const related = ev({ issue: "kipping" });
    expect(pickMoment([unrelated, related], { duration: 10, exercise: "pull_up" })).toBe(related);
  });
  it("empty events → null", () => {
    expect(pickMoment([], { duration: 10 })).toBeNull();
  });
});
