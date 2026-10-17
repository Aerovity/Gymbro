import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeAngleReport, computeMetric, hipOffset, offsetTowardFloor } from "@/lib/angles/compute";
import { ghostPose } from "@/lib/angles/ghost";
import { angleAt, toPx } from "@/lib/angles/math";
import { EXERCISE_INFO, EXERCISE_ORDER, isSupportedExercise } from "@/lib/exercises/catalog";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { PHASE, PRIMARY_KEY, PUSHUP_TOP_MIN_ELBOW, RULES, RULE_VARIANTS, inferPhase } from "@/lib/exercises/rules";
import { verifyAfter } from "@/lib/exercises/verify";
import { BODY_SIGNAL, bodyPartFor, bodySignal, chooseSignal } from "@/lib/moments/refine";
import { LM } from "@/lib/pose/landmarks";
import { CoachReportSchema } from "@/lib/schemas";
import { EXERCISES, type AngleReport, type PoseResult } from "@/lib/types";
import { frontPushUp, sidePushUp, withVisibility } from "../helpers/pose";

const get = (r: AngleReport, key: string) => r.angles.find((a) => a.key === key)!;
const ids = (r: AngleReport) => r.violations.map((v) => v.ruleId);

describe("catalog: offered exercises", () => {
  it("only push-ups and pull-ups are offered, in that order", () => {
    expect(EXERCISE_ORDER).toEqual(["push_up", "pull_up"]);
    expect(EXERCISES).toContain("push_up");
    expect(isSupportedExercise("push_up")).toBe(true);
    expect(isSupportedExercise("pull_up")).toBe(true);
    expect(isSupportedExercise("squat")).toBe(false);
    expect(isSupportedExercise(undefined)).toBe(false);
  });
  it("push-up info", () => {
    expect(EXERCISE_INFO.push_up).toMatchObject({ id: "push_up", label: "Push-up", human: "push-up", bestView: "side" });
    expect(EXERCISE_INFO.push_up.cameraHint).toBe("Film from the side at floor level, whole body in frame.");
    expect(EXERCISE_INFO.push_up.editHint).toMatch(/straight rigid line from head to heels/);
    expect(EXERCISE_INFO.push_up.editHint).toMatch(/45°/);
    expect(EXERCISE_INFO.push_up.faults).toMatch(/sagging hips.*piked hips.*partial depth/);
    expect(EXERCISE_INFO.pull_up.cameraHint).toBe("Film from behind or the side, bar and whole body in frame.");
  });
});

describe("push-up rules", () => {
  it("rule table: heuristic, view-gated, documented targets", () => {
    const byKey = Object.fromEntries(RULES.push_up.map((r) => [r.angleKey, r]));
    expect(byKey.elbow_bottom).toMatchObject({ id: "pushup_depth", phase: "bottom", view: "any", target: { max: 90, ideal: 80 } });
    expect(byKey.body_line).toMatchObject({ id: "pushup_body_line", phase: "any", view: "any", target: { min: 165, ideal: 178 } });
    expect(byKey.elbow_top).toMatchObject({ id: "pushup_lockout", phase: "top", target: { min: 160, ideal: 172 } });
    expect(byKey.head_line).toMatchObject({ id: "pushup_head", view: "side", target: { min: 150, ideal: 170 } });
    expect(byKey.elbow_flare).toMatchObject({ id: "pushup_elbow_flare", view: "front", phase: "bottom", target: { max: 60, ideal: 45 } });
    expect(RULES.push_up.every((r) => r.basis === "heuristic")).toBe(true);
    expect(PRIMARY_KEY.push_up).toBe("elbow_bottom");
    expect(PHASE.push_up).toMatchObject({ phase: "bottom", extremum: "min" });
  });

  it("clean bottom position: depth, straight body line and neutral head pass", () => {
    const r = computeAngleReport(sidePushUp({ elbow: 80 }), "push_up");
    expect(r.view).toBe("side");
    expect(r.side).toBe("left");
    expect(get(r, "elbow_bottom").value!).toBeCloseTo(80, 0);
    expect(get(r, "body_line").value!).toBeCloseTo(180, 0);
    expect(get(r, "head_line").value!).toBeCloseTo(172, 0);
    expect(get(r, "body_line").variant).toBeUndefined();
    expect(get(r, "elbow_flare").status).toBe("unmeasurable"); // front view only
    expect(r.violations).toEqual([]);
    expect(r.score).toBe(100);
  });

  it("hip offset sign: + = sag toward the floor, − = pike, for either facing direction", () => {
    expect(hipOffset(sidePushUp({ elbow: 80, hipOffset: 0.25 }), "left")!).toBeGreaterThan(0.2);
    expect(hipOffset(sidePushUp({ elbow: 80, hipOffset: -0.25 }), "left")!).toBeLessThan(-0.2);
    expect(computeMetric(sidePushUp({ elbow: 80, hipOffset: 0.25, facing: -1, side: "right" }), "push_up", "hip_offset")!).toBeGreaterThan(0.2);
    expect(computeMetric(sidePushUp({ elbow: 80, hipOffset: -0.25, facing: -1, side: "right" }), "push_up", "hip_offset")!).toBeLessThan(-0.2);
    expect(Math.abs(computeMetric(sidePushUp({ elbow: 80 }), "push_up", "hip_offset")!)).toBeLessThan(1e-6);
    // Geometry helper: a point below a horizontal line is +, above is −.
    expect(offsetTowardFloor({ x: 5, y: 12 }, { x: 0, y: 10 }, { x: 10, y: 10 })).toBeCloseTo(2);
    expect(offsetTowardFloor({ x: 5, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 10 })).toBeCloseTo(-3);
    expect(offsetTowardFloor({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it("sagging hips: label, cue, variant and note say sag", () => {
    const r = computeAngleReport(sidePushUp({ elbow: 80, hipOffset: 0.25 }), "push_up");
    const m = get(r, "body_line");
    expect(m.value!).toBeLessThan(165);
    expect(m).toMatchObject({ status: "bad", variant: "sag", label: "Hips sagging" });
    expect(m.note).toMatch(/below the shoulder–ankle line/);
    const v = r.violations[0];
    expect(v).toMatchObject({ ruleId: "pushup_body_line", label: "Hips sagging", variant: "sag" });
    expect(v.cue).toBe(RULE_VARIANTS.pushup_body_line.sag.cue);
    expect(v.cue).toMatch(/sagging/i);
    expect(v.severity).toBeGreaterThanOrEqual(3); // devScale 2: a 159° line is a clear sag
  });

  it("piked hips: the same angle reads as a pike", () => {
    const r = computeAngleReport(sidePushUp({ elbow: 80, hipOffset: -0.25 }), "push_up");
    const m = get(r, "body_line");
    expect(m).toMatchObject({ status: "bad", variant: "pike", label: "Hips piking" });
    expect(m.note).toMatch(/above the shoulder–ankle line/);
    expect(r.violations[0]).toMatchObject({ label: "Hips piking", variant: "pike" });
    expect(r.violations[0].cue).toMatch(/piking/i);
    expect(r.violations[0].cue).not.toMatch(/sag/i);
  });

  it("partial depth: a shallow bottom is judged on depth, not lockout", () => {
    const pose = sidePushUp({ elbow: 125 });
    expect(inferPhase(pose, "push_up")).toBe("bottom");
    const r = computeAngleReport(pose, "push_up");
    expect(get(r, "elbow_bottom").value!).toBeCloseTo(125, 0);
    expect(r.angles.some((a) => a.key === "elbow_top")).toBe(false);
    expect(r.violations[0]).toMatchObject({ ruleId: "pushup_depth", angleKey: "elbow_bottom", severity: 5 });
    expect(computeAngleReport(sidePushUp({ elbow: 92 }), "push_up").angles.find((a) => a.key === "elbow_bottom")!.status).toBe("borderline");
  });

  it("lockout: straight-arm frames are the top; soft elbows get flagged", () => {
    expect(PUSHUP_TOP_MIN_ELBOW).toBe(150);
    const soft = sidePushUp({ elbow: 152 });
    expect(inferPhase(soft, "push_up")).toBe("top");
    const r = computeAngleReport(soft, "push_up");
    expect(r.angles.some((a) => a.key === "elbow_bottom")).toBe(false);
    expect(get(r, "elbow_top").value!).toBeCloseTo(152, 0);
    expect(ids(r)).toEqual(["pushup_lockout"]);
    const locked = computeAngleReport(sidePushUp({ elbow: 176 }), "push_up");
    expect(locked.violations).toEqual([]);
    expect(get(locked, "elbow_top").status).toBe("good");
  });

  it("head line: dropping vs craning", () => {
    const drop = computeAngleReport(sidePushUp({ elbow: 80, neck: 135 }), "push_up");
    expect(drop.violations[0]).toMatchObject({ ruleId: "pushup_head", label: "Head dropping", variant: "drop" });
    const crane = computeAngleReport(sidePushUp({ elbow: 80, neck: 135, head: "crane" }), "push_up");
    expect(crane.violations[0]).toMatchObject({ ruleId: "pushup_head", label: "Head craning up", variant: "crane" });
  });

  it("front view: elbow flare from 3D world landmarks; body line in 3D; head line needs the side view", () => {
    const flared = computeAngleReport(frontPushUp({ flare: 80 }), "push_up");
    expect(flared.view).toBe("front");
    expect(get(flared, "elbow_flare").value!).toBeCloseTo(80, 0);
    expect(ids(flared)).toContain("pushup_elbow_flare");
    expect(get(flared, "body_line").value).not.toBeNull();
    expect(get(flared, "body_line").note).toMatch(/3D/);
    expect(get(flared, "head_line").status).toBe("unmeasurable");
    const tucked = computeAngleReport(frontPushUp({ flare: 45 }), "push_up");
    expect(get(tucked, "elbow_flare").status).toBe("good");
    // Side view: flare is not measurable.
    expect(get(computeAngleReport(sidePushUp({ elbow: 80 }), "push_up"), "elbow_flare").note).toMatch(/in front or behind/);
  });

  it("visibility gate: a hidden near hip or ankle makes the body line unmeasurable", () => {
    const pose = withVisibility(sidePushUp({ elbow: 80, hipOffset: 0.3 }), [LM.L_HIP], 0.2);
    const r = computeAngleReport(pose, "push_up");
    expect(get(r, "body_line").status).toBe("unmeasurable");
    expect(get(r, "body_line").variant).toBeUndefined();
    expect(ids(r)).not.toContain("pushup_body_line");
  });

  it("phase signal + body-height fallback: bottom = most bent elbows / lowest shoulders", () => {
    const bottom = sidePushUp({ elbow: 80 });
    const top = sidePushUp({ elbow: 175 });
    expect(PHASE.push_up.signal(bottom)!).toBeCloseTo(80, 0);
    expect(PHASE.push_up.signal(top)!).toBeCloseTo(175, 0);
    expect(BODY_SIGNAL.push_up).toMatchObject({ extremum: "max" });
    expect(bodySignal(bottom, "push_up")!).toBeGreaterThan(bodySignal(top, "push_up")!);
    const hidden = (p: ReturnType<typeof sidePushUp>) => withVisibility(p, [LM.L_ELBOW, LM.R_ELBOW], 0.1);
    const samples = [top, bottom, top].map((p) => ({ pose: hidden(p), signal: PHASE.push_up.signal(hidden(p)), body: bodySignal(p, "push_up") }));
    const sig = chooseSignal(samples, "push_up");
    expect(sig.kind).toBe("body");
    expect(sig.extremum).toBe("max");
    expect(bodyPartFor("body_line")).toBe("hips");
    expect(bodyPartFor("head_line")).toBe("head");
    expect(bodyPartFor("elbow_bottom")).toBe("arms");
  });

  it("verify re-measures the after pose in the before frame's phase", () => {
    const beforePose = sidePushUp({ elbow: 80, hipOffset: 0.3 });
    const before = computeAngleReport(beforePose, "push_up");
    const v = verifyAfter(before, beforePose, sidePushUp({ elbow: 80 }), "push_up");
    expect(v.primaryKey).toBe("body_line");
    expect(v.passed).toBe(true);
    expect(verifyAfter(before, beforePose, sidePushUp({ elbow: 80, hipOffset: 0.4 }), "push_up").passed).toBe(false);
  });
});

describe("push-up fallback coach", () => {
  const event = {
    t_start: 3,
    t_peak: 3.4,
    t_end: 3.8,
    rep_index: 2,
    issue: "sagging_hips",
    body_part: "hips",
    severity: 3,
    confidence: 0.7,
    description: "Hips drop at the bottom.",
  };
  it("sag: wording, drill and image-edit description", () => {
    const c = ruleBasedCoach(computeAngleReport(sidePushUp({ elbow: 80, hipOffset: 0.3 }), "push_up"), event);
    expect(() => CoachReportSchema.parse(c)).not.toThrow();
    expect(c.primary_fault).toMatchObject({ id: "pushup_body_line", title: "Hips sagging", body_part: "hips" });
    expect(c.headline).toBe("HIPS SAGGING — SQUEEZE YOUR GLUTES");
    expect(c.spoken_summary).toMatch(/push-up/);
    expect(c.spoken_summary).toMatch(/sagged/);
    expect(c.spoken_summary).not.toMatch(/pik/i);
    expect(c.spoken_summary).not.toMatch(/[—–;:%{}[\]]/);
    expect(c.cues[0]).toMatch(/sagging/i);
    expect(c.drill.name).toBe("Incline push-ups + 3-second negatives");
    expect(c.drill.prescription).toBeTruthy();
    expect(c.drill.why).toBeTruthy();
    expect(c.corrected_pose.description).toMatch(/^Show the same lifter at the bottom of the push-up/);
    expect(c.corrected_pose.description).toMatch(/no sag/);
    expect(c.angle_feedback.find((a) => a.angle_key === "body_line")!.comment).toMatch(/sagging/i);
  });
  it("pike: worded as a pike", () => {
    const c = ruleBasedCoach(computeAngleReport(sidePushUp({ elbow: 80, hipOffset: -0.3 }), "push_up"));
    expect(c.primary_fault.title).toBe("Hips piking");
    expect(c.headline).toMatch(/PIKED/);
    expect(c.spoken_summary).toMatch(/piked/);
    expect(c.spoken_summary).not.toMatch(/sag/i);
    expect(c.corrected_pose.description).toMatch(/no pike/);
  });
  it("depth and lockout", () => {
    const depth = ruleBasedCoach(computeAngleReport(sidePushUp({ elbow: 125 }), "push_up"));
    expect(depth.primary_fault).toMatchObject({ id: "pushup_depth", title: "Partial depth" });
    expect(depth.spoken_summary).toMatch(/125°/);
    expect(depth.corrected_pose.joint_targets).toContainEqual({ angle_key: "elbow_bottom", target_deg: 80 });
    const lock = ruleBasedCoach(computeAngleReport(sidePushUp({ elbow: 152 }), "push_up"));
    expect(lock.primary_fault).toMatchObject({ id: "pushup_lockout", title: "Soft lockout" });
    expect(lock.corrected_pose.description).toMatch(/^Show the same lifter at the top of the push-up/);
  });
  it("clean rep", () => {
    const c = ruleBasedCoach(computeAngleReport(sidePushUp({ elbow: 80 }), "push_up"));
    expect(c.headline).toBe("CLEAN REP — KEEP STACKING THEM");
    expect(c.spoken_summary).toMatch(/Clean push-up/);
  });
});

describe("push-up ghost (target skeleton on the user's frame)", () => {
  const px = (p: ReturnType<typeof sidePushUp>) => p.landmarks.map((l) => toPx(l, p.width, p.height));
  it("straightens the plank and reaches depth with hands and toes planted", () => {
    const pose = sidePushUp({ elbow: 125, hipOffset: 0.3 });
    const g = ghostPose(pose, computeAngleReport(pose, "push_up"));
    const o = px(pose);
    expect(angleAt(g[LM.L_SHOULDER], g[LM.L_HIP], g[LM.L_ANKLE])!).toBeGreaterThan(178);
    expect(angleAt(g[LM.L_SHOULDER], g[LM.L_ELBOW], g[LM.L_WRIST])!).toBeCloseTo(80, 3);
    for (const i of [LM.L_WRIST, LM.R_WRIST, LM.L_FOOT, LM.R_FOOT, LM.L_INDEX]) {
      expect(g[i].x).toBeCloseTo(o[i].x, 6);
      expect(g[i].y).toBeCloseTo(o[i].y, 6);
    }
    expect(g[LM.L_SHOULDER].y).toBeGreaterThan(o[LM.L_SHOULDER].y); // chest lowered toward the floor
    // Segment lengths are kept.
    const len = (p: { x: number; y: number }[], a: number, b: number) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
    expect(len(g, LM.L_SHOULDER, LM.L_ELBOW)).toBeCloseTo(len(o, LM.L_SHOULDER, LM.L_ELBOW), 6);
    expect(len(g, LM.L_ELBOW, LM.L_WRIST)).toBeCloseTo(len(o, LM.L_ELBOW, LM.L_WRIST), 6);
  });
  it("head in line; no violations → original points", () => {
    const pose = sidePushUp({ elbow: 80, neck: 135 });
    const g = ghostPose(pose, computeAngleReport(pose, "push_up"));
    expect(angleAt(g[LM.L_EAR], g[LM.L_SHOULDER], g[LM.L_HIP])!).toBeCloseTo(170, 4);
    const clean = sidePushUp({ elbow: 80 });
    expect(ghostPose(clean, computeAngleReport(clean, "push_up"))).toEqual(px(clean));
  });
});

describe("push-up filmed from behind at ~45° (real heavy-model pose, bottom of a deep rep)", () => {
  const { pose } = JSON.parse(readFileSync(resolve("tests/fixtures/landmarks-pushup-rear45.json"), "utf8")) as { pose: PoseResult };

  it("is read as the bottom, with depth and body line measured (not blank)", () => {
    expect(inferPhase(pose, "push_up")).toBe("bottom");
    const r = computeAngleReport(pose, "push_up");
    expect(r.view).not.toBe("side");
    const depth = r.angles.find((a) => a.key === "elbow_bottom")!;
    const line = r.angles.find((a) => a.key === "body_line")!;
    // The visible arm is foreshortened (reads ~159° in 3D); the more bent arm (~104°) is the depth estimate.
    expect(depth.value!).toBeGreaterThan(85);
    expect(depth.value!).toBeLessThan(120);
    // MediaPipe marks that arm as hidden → shown as an estimate, never scored as a violation.
    expect(depth.reliable).toBe(false);
    expect(r.violations.map((v) => v.angleKey)).not.toContain("elbow_bottom");
    // Shoulder, hip and ankle are clear → the 3D body line is a real measurement (~170°, straight enough).
    expect(line.reliable).toBe(true);
    expect(line.value!).toBeGreaterThan(160);
    expect(line.status).toBe("good");
  });
});
