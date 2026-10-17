import { describe, expect, it } from "vitest";
import { computeAngleReport } from "@/lib/angles/compute";
import { ghostPose, mirrorIndex, setJointAngle, subtree } from "@/lib/angles/ghost";
import { angleAt, toPx } from "@/lib/angles/math";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { identityDrift, verifyAfter } from "@/lib/exercises/verify";
import { compactKeypoints } from "@/lib/pose/compact";
import { DRAWN_JOINTS, LM } from "@/lib/pose/landmarks";
import { CoachReportSchema } from "@/lib/schemas";
import { EXERCISES, type AngleReport, type PoseResult, type ScanEvent } from "@/lib/types";
import { benchFront, makePose, pullUp, sideSquat } from "../helpers/pose";

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;

const event: ScanEvent = {
  t_start: 6.8,
  t_peak: 7.2,
  t_end: 7.6,
  rep_index: 3,
  issue: "partial_range_top",
  body_part: "arms",
  severity: 4,
  confidence: 0.8,
  description: "Chin does not clear the bar.",
};

describe("ruleBasedCoach", () => {
  const partial = computeAngleReport(pullUp({ elbowL: 100, knee: 125, noseVis: 0.2 }), "pull_up");

  it("pull-up: valid CoachReport quoting rounded numbers, punchy and with the right drill", () => {
    const c = ruleBasedCoach(partial, event);
    expect(() => CoachReportSchema.parse(c)).not.toThrow();
    expect(c.primary_fault.id).toBe("pullup_top_elbow");
    expect(c.spoken_summary).toMatch(/100°/);
    expect(c.spoken_summary).toMatch(/7 seconds/);
    expect(c.spoken_summary).toMatch(/rep 4/); // rep_index is 0-based; speech is 1-based
    const n = sentences(c.spoken_summary);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
    expect(c.spoken_summary).not.toMatch(/[—–;:%{}[\]]/);
    expect(c.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(c.drill.name).toMatch(/Scap pull-ups/);
    expect(c.drill.name).toMatch(/negatives/);
    expect(c.secondary_faults.length).toBeLessThanOrEqual(2);
    expect(c.secondary_faults.length).toBeGreaterThan(0);
    expect(c.cues[0]).toBe("Pull your elbows down to your ribs — chin over the bar.");
    expect(c.corrected_pose.description).toMatch(/^Show the same lifter at the top of the pull-up/);
    expect(c.corrected_pose.description).toMatch(/chin clearly above the bar/);
    expect(c.corrected_pose.joint_targets).toContainEqual({ angle_key: "elbow_top", target_deg: 60 });
    expect(c.angle_feedback.find((a) => a.angle_key === "elbow_top")).toMatchObject({
      actual_deg: 100,
      target_max_deg: 75,
      target_ideal_deg: 60,
      verdict: "bad",
    });
    expect(c.safety_note).toBeTruthy();
    expect(c.form_score_adjustment).toBe(0);
  });

  it("serious video-model flag that pose can't confirm leads the report", () => {
    const good = computeAngleReport(pullUp({ elbowL: 55 }), "pull_up");
    const c = ruleBasedCoach(good, event);
    expect(() => CoachReportSchema.parse(c)).not.toThrow();
    expect(c.primary_fault.id).toBe(event.issue);
    expect(c.spoken_summary).toMatch(/video model caught partial range top/);
    expect(c.spoken_summary).not.toMatch(/Clean/);
  });

  it("clean rep → encouraging, no fault, still valid", () => {
    const good = computeAngleReport(pullUp({ elbowL: 55 }), "pull_up");
    const c = ruleBasedCoach(good, { ...event, severity: 2 });
    expect(() => CoachReportSchema.parse(c)).not.toThrow();
    expect(c.primary_fault.id).toBe("none");
    expect(c.spoken_summary).toMatch(/partial range top/);
    expect(c.safety_note).toBeNull();
    const n = sentences(c.spoken_summary);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
    expect(ruleBasedCoach(good).spoken_summary).toMatch(/on target/);
  });

  it("minor faults get softer copy", () => {
    const r = computeAngleReport(benchFront({ flareL: 78 }), "bench_press");
    const c = ruleBasedCoach(r);
    expect(c.primary_fault.severity).toBe(1);
    expect(c.spoken_summary).toMatch(/small tweak/);
    expect(c.safety_note).toBeNull();
  });

  it("unmeasurable angles appear with null actuals", () => {
    const r = computeAngleReport(sideSquat({ knee: 115, tibia: 25, torso: 47 }), "squat");
    const c = ruleBasedCoach(r);
    const cave = c.angle_feedback.find((a) => a.angle_key === "knee_ankle_width")!;
    expect(cave.actual_deg).toBeNull();
    expect(cave.verdict).toBe("unmeasurable");
    expect(c.spoken_summary).toMatch(/115°/);
    expect(c.drill.name).toMatch(/box squat/i);
  });

  it("produces valid reports for every exercise and every rule (synthetic violations)", () => {
    for (const ex of EXERCISES) {
      const base = computeAngleReport(makePose({}), ex);
      const viol = base.angles.map((a) => ({
        ruleId: a.ruleId!,
        label: a.label,
        angleKey: a.key,
        actual: (a.target!.max ?? a.target!.min!) + (a.target!.max !== undefined ? 20 : -20),
        target: a.target!,
        deviation: 20,
        severity: 3,
        cue: "Do the thing — properly.",
        basis: "heuristic" as const,
      }));
      for (const v of viol) {
        const report: AngleReport = { ...base, violations: [v, ...viol.filter((x) => x !== v)] };
        const c = ruleBasedCoach(report, { ...event, rep_index: undefined });
        expect(() => CoachReportSchema.parse(c), `${ex}/${v.ruleId}`).not.toThrow();
        expect(c.spoken_summary).not.toMatch(/undefined|NaN/);
        expect(c.corrected_pose.description).not.toMatch(/undefined|NaN/);
        expect(c.headline).not.toMatch(/undefined|NaN/);
        expect(c.primary_fault.explanation).not.toMatch(/undefined|NaN/);
      }
      // Unknown rule ids fall back to generic copy.
      const unknown: AngleReport = {
        ...base,
        violations: [{ ...viol[0], ruleId: "mystery_rule", label: "Mystery" }],
      };
      expect(() => CoachReportSchema.parse(ruleBasedCoach(unknown))).not.toThrow();
    }
  });
});

describe("verifyAfter", () => {
  const beforePose = pullUp({ elbowL: 100 });
  const before = computeAngleReport(beforePose, "pull_up");

  it("passes when the primary metric reaches the target", () => {
    const v = verifyAfter(before, beforePose, pullUp({ elbowL: 60 }), "pull_up");
    expect(v.primaryKey).toBe("elbow_top");
    expect(v.primaryBefore).toBeCloseTo(100, 0);
    expect(v.primaryAfter).toBeCloseTo(60, 0);
    expect(v.passed).toBe(true);
    expect(v.attempts).toBe(1);
    expect(v.angles.map((a) => a.key)).toEqual(before.angles.map((a) => a.key));
  });
  it("passes within 10° of the target, fails beyond", () => {
    expect(verifyAfter(before, beforePose, pullUp({ elbowL: 84 }), "pull_up").passed).toBe(true);
    expect(verifyAfter(before, beforePose, pullUp({ elbowL: 90 }), "pull_up", 2)).toMatchObject({ passed: false, attempts: 2 });
  });
  it("fails when the after pose is unmeasurable", () => {
    const hidden = pullUp({ elbowL: 60, vis: 0.1 });
    const v = verifyAfter(before, beforePose, hidden, "pull_up");
    expect(v.primaryAfter).toBeNull();
    expect(v.passed).toBe(false);
  });
  it("falls back to PRIMARY_KEY when nothing was violated", () => {
    const good = pullUp({ elbowL: 55 });
    const v = verifyAfter(computeAngleReport(good, "pull_up"), good, good, "pull_up");
    expect(v.primaryKey).toBe("elbow_top");
    expect(v.passed).toBe(true);
    expect(v.identityDrift).toBe(0);
  });
  it("identity drift compares torso length and shoulder width normalised by image size", () => {
    const a = makePose({});
    const wider = makePose({ [LM.L_SHOULDER]: [380, 250], [LM.R_SHOULDER]: [620, 250] });
    expect(identityDrift(a, wider)).toBeCloseTo(240 / 180 - 1, 2);
    // Same body in a 2× larger image → no drift.
    const scaled: PoseResult = { ...a, width: a.width * 2, height: a.height * 2 };
    expect(identityDrift(a, scaled)).toBeCloseTo(0, 6);
    const sideA = sideSquat({ knee: 90, tibia: 20, torso: 30 });
    expect(identityDrift(sideA, sideA)).toBe(0);
  });
});

describe("ghostPose", () => {
  it("pull-up: rotates both forearms so the elbow reaches the ideal 60°", () => {
    const pose = pullUp({ elbowL: 100, elbowR: 110 });
    const report = computeAngleReport(pose, "pull_up");
    const g = ghostPose(pose, report);
    expect(g).toHaveLength(33);
    expect(angleAt(g[LM.L_SHOULDER], g[LM.L_ELBOW], g[LM.L_WRIST])).toBeCloseTo(60, 6);
    expect(angleAt(g[LM.R_SHOULDER], g[LM.R_ELBOW], g[LM.R_WRIST])).toBeCloseTo(60, 6);
    const orig = toPx(pose.landmarks[LM.L_ELBOW], pose.width, pose.height);
    expect(g[LM.L_ELBOW].x).toBeCloseTo(orig.x, 9); // vertex unchanged
    // Hand points travel with the wrist.
    const before = toPx(pose.landmarks[LM.L_INDEX], pose.width, pose.height);
    const wBefore = toPx(pose.landmarks[LM.L_WRIST], pose.width, pose.height);
    expect(Math.hypot(g[LM.L_INDEX].x - g[LM.L_WRIST].x, g[LM.L_INDEX].y - g[LM.L_WRIST].y)).toBeCloseTo(
      Math.hypot(before.x - wBefore.x, before.y - wBefore.y),
      6,
    );
  });
  it("squat: rotates the shank about the knee (carrying heel and toe)", () => {
    const pose = sideSquat({ knee: 115, tibia: 25, torso: 47 });
    const g = ghostPose(pose, computeAngleReport(pose, "squat"));
    expect(angleAt(g[LM.L_HIP], g[LM.L_KNEE], g[LM.L_ANKLE])).toBeCloseTo(80, 6);
    const heel0 = toPx(pose.landmarks[LM.L_HEEL], pose.width, pose.height);
    expect(g[LM.L_HEEL].x).not.toBeCloseTo(heel0.x, 1);
  });
  it("bench: rotates the upper arm about the shoulder (proximal-first chain)", () => {
    const pose = benchFront({ flareL: 88 });
    const g = ghostPose(pose, computeAngleReport(pose, "bench_press"));
    expect(angleAt(g[LM.L_ELBOW], g[LM.L_SHOULDER], g[LM.L_HIP])).toBeCloseTo(60, 6);
    expect(angleAt(g[LM.R_ELBOW], g[LM.R_SHOULDER], g[LM.R_HIP])).toBeCloseTo(60, 6);
  });
  it("supplement metrics (back rounding) map to the interior angle", () => {
    const report: AngleReport = {
      exercise: "deadlift",
      view: "side",
      side: "left",
      angles: [
        {
          key: "back_rounding",
          label: "x",
          value: 40,
          unit: "°",
          points: [LM.L_EAR, LM.L_SHOULDER, LM.L_HIP],
          reliable: true,
          status: "bad",
          deviation: 15,
          ruleId: "deadlift_rounding",
        },
      ],
      violations: [
        { ruleId: "deadlift_rounding", label: "x", angleKey: "back_rounding", actual: 40, target: { max: 25, ideal: 10 }, deviation: 15, severity: 3, cue: "c", basis: "heuristic" },
      ],
      score: 70,
      grade: "B",
    };
    const pose = makePose({ [LM.L_EAR]: [300, 160] });
    const g = ghostPose(pose, report);
    expect(angleAt(g[LM.L_EAR], g[LM.L_SHOULDER], g[LM.L_HIP])).toBeCloseTo(170, 6);
  });
  it("no joint violation → original points", () => {
    const pose = pullUp({ elbowL: 55, hipShiftX: 100 });
    const g = ghostPose(pose, computeAngleReport(pose, "pull_up"));
    expect(g).toEqual(pose.landmarks.map((l) => toPx(l, pose.width, pose.height)));
  });
  it("helpers", () => {
    expect(subtree(LM.L_ELBOW).sort((a, b) => a - b)).toEqual([LM.L_ELBOW, LM.L_WRIST, 17, 19, 21]);
    expect(subtree(LM.NOSE)).toContain(LM.L_EAR);
    expect(mirrorIndex(LM.L_KNEE)).toBe(LM.R_KNEE);
    expect(mirrorIndex(LM.R_KNEE)).toBe(LM.L_KNEE);
    expect(mirrorIndex(2)).toBe(5);
    expect(mirrorIndex(5)).toBe(2);
    expect(mirrorIndex(LM.NOSE)).toBe(LM.NOSE);
    const pts = [{ x: 0, y: 0 }];
    expect(setJointAngle(pts, [LM.L_HIP, LM.L_SHOULDER, LM.R_SHOULDER], 90)).toBe(false);
  });
});

describe("compactKeypoints", () => {
  it("DRAWN_JOINTS only, pixel coordinates rounded", () => {
    const pose = pullUp({ elbowL: 90 });
    const k = compactKeypoints(pose);
    expect(k.map((x) => x.i)).toEqual([...DRAWN_JOINTS]);
    const nose = k.find((x) => x.name === "nose")!;
    expect(nose.x).toBe(Math.round(pose.landmarks[0].x * 720));
    expect(Number.isInteger(nose.y)).toBe(true);
    expect(nose.v).toBe(0.95);
    expect(compactKeypoints({ ...pose, landmarks: pose.landmarks.slice(0, 5) })).toHaveLength(1);
  });
});
