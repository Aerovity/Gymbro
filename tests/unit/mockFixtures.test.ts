import { describe, expect, it } from "vitest";
import { mockCoachFor, mockScanFor } from "@/lib/demo/serverFixtures";
import { computeAngleReport } from "@/lib/angles/compute";
import { CoachReportSchema, ScanResultSchema } from "@/lib/schemas";
import { sidePushUp } from "../helpers/pose";

describe("mock-mode fixtures never turn a push-up into a pull-up", () => {
  it("scan: claims pull_up only when chosen; auto leaves the exercise to the pose classifier", () => {
    const auto = mockScanFor({ exercise: "auto", duration: 15 });
    expect(auto.exercise).toBeUndefined();
    expect(auto.provider).toBe("demo");
    expect(() => ScanResultSchema.parse(auto)).not.toThrow();
    expect(mockScanFor({ exercise: "pull_up", duration: 15 }).exercise).toBe("pull_up");
    expect(mockScanFor({ exercise: "push_up", duration: 15 }).exercise).toBe("push_up");
  });
  it("scan: events are clamped into a shorter clip", () => {
    const short = mockScanFor({ exercise: "push_up", duration: 5 });
    for (const e of short.events) {
      expect(e.t_peak).toBeLessThanOrEqual(5);
      expect(e.t_end).toBeLessThanOrEqual(5);
    }
  });
  it("coach: push-ups get rule-based coaching from their own measurements", () => {
    const r = computeAngleReport(sidePushUp({ elbow: 80, hipOffset: 0.3 }), "push_up");
    const c = mockCoachFor({ exercise: "push_up", view: r.view, side: r.side, angles: r.angles, violations: r.violations });
    expect(() => CoachReportSchema.parse(c)).not.toThrow();
    expect(c.primary_fault.title).toBe("Hips sagging");
    expect(JSON.stringify(c)).not.toMatch(/pull-up|chin/i);
    const pull = mockCoachFor({ exercise: "pull_up", view: "front", side: "both", angles: [], violations: [] });
    expect(pull.drill.name).toMatch(/pull-up/i);
  });
});

describe("mock scan never leaks pull-up fault words into another exercise", () => {
  it("auto / push-up scans keep the fixture timing but drop its pull-up descriptions", () => {
    for (const exercise of ["auto", "push_up"] as const) {
      const s = mockScanFor({ exercise, duration: 15 });
      expect(s.events.length).toBeGreaterThan(0);
      expect(JSON.stringify(s)).not.toMatch(/pull|chin|bar\b|knee_kick/i);
      expect(() => ScanResultSchema.parse(s)).not.toThrow();
    }
    const pull = mockScanFor({ exercise: "pull_up", duration: 15 });
    expect(pull.events.some((e) => e.issue !== "hardest_rep")).toBe(true);
  });
});
