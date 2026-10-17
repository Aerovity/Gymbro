import { describe, expect, it } from "vitest";
import { buildScanPrompt, exerciseLine, exerciseOptions, faultsList } from "@/lib/prompts/scan";
import { SCAN_JSON_SCHEMA, buildPickPrompt } from "@/lib/prompts/pick";
import { buildEditPrompt } from "@/lib/prompts/imageEdit";
import { buildCoachUserPrompt } from "@/lib/prompts/coach";
import { toProviderScan } from "@/lib/providers/scanCommon";
import { computeAngleReport } from "@/lib/angles/compute";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { EXERCISE_INFO } from "@/lib/exercises/catalog";
import { sidePushUp } from "../helpers/pose";

const UNOFFERED = ["squat", "bench_press", "deadlift", "overhead_press", "biceps_curl"];

describe("scan prompt: only push_up | pull_up", () => {
  const auto = buildScanPrompt({ exercise: "auto", duration: 12, effectiveFps: 2.5 });
  it("auto mode classifies between the offered exercises only", () => {
    expect(auto).toMatch(/classify it as exactly one of: push_up, pull_up/);
    expect(auto).toContain('"exercise":"<push_up|pull_up>"');
    expect(auto).toMatch(/push_up = body roughly horizontal facing the floor, hands on the floor/);
    expect(auto).toMatch(/pull_up = hanging from an overhead bar/);
    for (const id of UNOFFERED) expect(auto).not.toContain(id);
    expect(auto).not.toMatch(/squat|bench|deadlift|overhead press|curl/i);
    expect(exerciseOptions()).toBe("push_up|pull_up");
  });
  it("lists the offered exercises' faults in auto mode, only the chosen one otherwise", () => {
    expect(faultsList()).toBe(`- push_up: ${EXERCISE_INFO.push_up.faults}\n- pull_up: ${EXERCISE_INFO.pull_up.faults}`);
    const push = buildScanPrompt({ exercise: "push_up", duration: 12, effectiveFps: 2.5 });
    expect(push).toContain("Exercise: push_up (push-up).");
    expect(push).toContain(`- push_up: ${EXERCISE_INFO.push_up.faults}`);
    expect(push).not.toMatch(/chin|kipping/);
    expect(push).toContain('(front and rear views are both "front")');
    expect(exerciseLine("pull_up")).toBe("pull_up (pull-up on a bar)");
  });
  it("GPT fallback prompt and strict schema enum", () => {
    const pick = buildPickPrompt({ exercise: "auto", duration: 12, timestamps: [1, 2, 3] });
    expect(pick).toMatch(/exercise must be one of push_up, pull_up/);
    for (const id of UNOFFERED) expect(pick).not.toContain(id);
    expect(SCAN_JSON_SCHEMA.properties.exercise.enum).toEqual(["push_up", "pull_up", null]);
  });
});

describe("auto-detected exercise from a provider", () => {
  const parsed = (exercise?: "squat" | "push_up" | "pull_up") => ({ ...(exercise ? { exercise } : {}), events: [] });
  it("keeps offered exercises, drops anything else (left for the pose classifier)", () => {
    expect(toProviderScan(parsed("push_up"), { exercise: "auto" }, "nemotron", "m", "").exercise).toBe("push_up");
    expect(toProviderScan(parsed("squat"), { exercise: "auto" }, "nemotron", "m", "").exercise).toBeUndefined();
    expect(toProviderScan(parsed(), { exercise: "auto" }, "nemotron", "m", "").exercise).toBeUndefined();
    // A user's explicit choice always wins.
    expect(toProviderScan(parsed("pull_up"), { exercise: "push_up" }, "nemotron", "m", "").exercise).toBe("push_up");
  });
});

describe("coach and image-edit prompts use the resolved exercise", () => {
  const report = computeAngleReport(sidePushUp({ elbow: 80, hipOffset: 0.3 }), "push_up");
  it("coach prompt: push-up name, correct-form reference and fault direction", () => {
    const text = buildCoachUserPrompt({
      exercise: "push_up",
      view: report.view,
      side: report.side,
      t: 3.4,
      provider: "nemotron",
      angles: report.angles,
      violations: report.violations,
      keypoints: [],
      frameDataUrl: "data:image/jpeg;base64,AA",
      W: 1280,
      H: 720,
    });
    expect(text).toContain("Exercise: push_up (push-up)");
    expect(text).toContain(`Correct push-up technique: ${EXERCISE_INFO.push_up.editHint}`);
    expect(text).toMatch(/body_line \(Hips sagging\): actual 1\d\d°.*direction sag/);
    expect(text).not.toMatch(/pull-up|chin/i);
  });
  it("edit prompt: push-up contact points, no bar grip", () => {
    const coach = ruleBasedCoach(report);
    const text = buildEditPrompt({ exercise: "push_up", correctedPose: coach.corrected_pose, primaryFault: coach.primary_fault.title });
    expect(text).toContain("performing a push-up during a workout");
    expect(text).toContain(EXERCISE_INFO.push_up.editHint);
    expect(text).toMatch(/palms flat on the floor/);
    expect(text).toMatch(/shoulder–hip–ankle body line ≈ 178°/);
    expect(text).not.toMatch(/grip on the bar|pull-up|in a gym/);
    const pull = buildEditPrompt({ exercise: "pull_up", correctedPose: { description: "x", joint_targets: [{ angle_key: "chin_clearance", target_deg: 0.15 }] } });
    expect(pull).toMatch(/gripping the bar/);
    expect(pull).toContain("chin clearance above the hands ≈ 0.15;");
  });
});
