import { describe, expect, it } from "vitest";
import { computeAngleReport, computeMetric, METRICS } from "@/lib/angles/compute";
import { chooseSide, detectView, isVisible, torsoLength } from "@/lib/angles/view";
import { LM } from "@/lib/pose/landmarks";
import { RULES } from "@/lib/exercises/rules";
import { EXERCISES, type AngleReport } from "@/lib/types";
import { AngleMeasurementSchema, RuleViolationSchema } from "@/lib/schemas";
import { armAt, benchFront, makePose, pullUp, seg, sideSquat, withVisibility } from "../helpers/pose";

const get = (r: AngleReport, key: string) => r.angles.find((a) => a.key === key)!;

describe("view detection", () => {
  it("side squat → side view; front skeleton → front", () => {
    expect(detectView(sideSquat({ knee: 100, tibia: 20, torso: 30 })).view).toBe("side");
    expect(detectView(makePose({})).view).toBe("front");
    expect(detectView(pullUp({ elbowL: 90 })).view).toBe("front");
  });
  it("oblique → angled", () => {
    const p = makePose({ [LM.L_SHOULDER]: [440, 250], [LM.R_SHOULDER]: [560, 250] });
    const { view, shoulderWidthRatio } = detectView(p);
    expect(shoulderWidthRatio).toBeGreaterThan(0.35);
    expect(shoulderWidthRatio).toBeLessThan(0.6);
    expect(view).toBe("angled");
  });
  it("invisible torso or degenerate torso → unknown", () => {
    const hidden = withVisibility(makePose({}), [11, 12, 23, 24], 0.1);
    expect(detectView(hidden).view).toBe("unknown");
    const flat = makePose({ [LM.L_HIP]: [410, 250], [LM.R_HIP]: [590, 250] });
    expect(detectView(flat).view).toBe("unknown");
    expect(detectView({ landmarks: [], worldLandmarks: [], width: 1, height: 1 }).view).toBe("unknown");
  });
  it("chooseSide picks the more visible side", () => {
    expect(chooseSide(sideSquat({ knee: 100, tibia: 20, torso: 30, side: "left" }))).toBe("left");
    expect(chooseSide(sideSquat({ knee: 100, tibia: 20, torso: 30, side: "right" }))).toBe("right");
  });
  it("isVisible gates at 0.5", () => {
    const p = withVisibility(makePose({}), [LM.L_KNEE], 0.49);
    expect(isVisible(p, [LM.L_HIP, LM.L_ANKLE])).toBe(true);
    expect(isVisible(p, [LM.L_HIP, LM.L_KNEE])).toBe(false);
    expect(isVisible(withVisibility(p, [LM.L_KNEE], 0.5), [LM.L_KNEE])).toBe(true);
    expect(isVisible(p, [99])).toBe(false);
  });
  it("torso length is in pixels", () => {
    expect(torsoLength(makePose({}))).toBeCloseTo(270, 6);
  });
});

describe("squat", () => {
  const bad = sideSquat({ knee: 115, tibia: 25, torso: 47 });
  const r = computeAngleReport(bad, "squat");

  it("bad squat fixture → knee ≈ 115 ± 1, trunk–tibia ≈ +22 ± 2", () => {
    expect(r.view).toBe("side");
    expect(r.side).toBe("left");
    expect(get(r, "knee_angle").value!).toBeCloseTo(115, 0);
    expect(Math.abs(get(r, "trunk_tibia").value! - 22)).toBeLessThanOrEqual(2);
    expect(get(r, "knee_angle").points).toEqual([LM.L_HIP, LM.L_KNEE, LM.L_ANKLE]);
  });
  it("flags depth as the primary fault and sorts by severity then deviation", () => {
    expect(r.violations[0].ruleId).toBe("squat_depth");
    expect(r.violations[0].severity).toBe(4);
    for (let i = 1; i < r.violations.length; i++) {
      expect(r.violations[i - 1].severity).toBeGreaterThanOrEqual(r.violations[i].severity);
    }
    expect(r.violations.map((v) => v.ruleId)).toContain("squat_trunk_tibia");
    expect(r.violations.find((v) => v.ruleId === "squat_depth")!.citation).toMatch(/Caterisano/);
    expect(r.grade).toBe("D");
  });
  it("front-only metrics are unmeasurable in side view with a helpful note", () => {
    const m = get(r, "knee_ankle_width");
    expect(m.status).toBe("unmeasurable");
    expect(m.reliable).toBe(false);
    expect(m.value).toBeNull();
    expect(m.note).toMatch(/front/);
  });
  it("every measurement and violation matches the shared Zod schemas", () => {
    for (const a of r.angles) expect(() => AngleMeasurementSchema.parse(a)).not.toThrow();
    for (const v of r.violations) expect(() => RuleViolationSchema.parse(v)).not.toThrow();
  });
  it("a good squat has no violations and grade A", () => {
    const good = computeAngleReport(sideSquat({ knee: 55, tibia: 30, torso: 35 }), "squat");
    expect(good.violations).toEqual([]);
    expect(good.score).toBe(100);
    expect(good.grade).toBe("A");
    expect(get(good, "hip_depth").value!).toBeGreaterThan(0);
  });
  it("knees far past the toes are never flagged", () => {
    // Very forward shin (knee well past the toes) with good depth and torso parallel to the shin.
    const p = sideSquat({ knee: 40, tibia: 45, torso: 45 });
    const kneeX = p.landmarks[LM.L_KNEE].x * p.width;
    const toeX = p.landmarks[LM.L_FOOT].x * p.width;
    expect(kneeX).toBeGreaterThan(toeX + 50);
    const rep = computeAngleReport(p, "squat");
    expect(rep.violations).toEqual([]);
    expect(RULES.squat.some((x) => /toe/.test(x.angleKey) || /over.?toe/i.test(x.label))).toBe(false);
  });
  it("heel lift is measured as a fraction of image height", () => {
    const rep = computeAngleReport(sideSquat({ knee: 60, tibia: 30, torso: 35, heelLiftPx: 60 }), "squat");
    expect(get(rep, "heel_lift").value).toBeCloseTo(0.06, 3);
    expect(rep.violations[0].ruleId).toBe("squat_heel_lift");
  });
  it("low-visibility landmarks → reliable:false, excluded from violations and score", () => {
    const hidden = withVisibility(bad, [LM.L_KNEE, LM.R_KNEE], 0.2);
    const rep = computeAngleReport(hidden, "squat");
    const k = get(rep, "knee_angle");
    expect(k.reliable).toBe(false);
    expect(k.status).toBe("unmeasurable");
    expect(k.note).toMatch(/visible/);
    expect(rep.violations.some((v) => v.angleKey === "knee_angle")).toBe(false);
    expect(rep.score).toBeGreaterThan(r.score);
  });
  it("front view squat measures knee cave", () => {
    const caved = makePose({ [LM.L_KNEE]: [470, 720], [LM.R_KNEE]: [530, 720] });
    const rep = computeAngleReport(caved, "squat");
    expect(rep.view).toBe("front");
    expect(rep.side).toBe("both");
    const m = get(rep, "knee_ankle_width");
    expect(m.value!).toBeCloseTo(60 / 128, 2);
    expect(rep.violations[0].ruleId).toBe("squat_knee_cave");
    expect(get(rep, "knee_angle").status).toBe("unmeasurable");
  });
  it("angled view adds the ±10° note", () => {
    const rep = computeAngleReport(sideSquat({ knee: 100, tibia: 20, torso: 30 }), "squat", { view: "angled" });
    expect(get(rep, "knee_angle").note).toMatch(/±10°/);
  });
  it("degenerate geometry → unmeasurable", () => {
    const p = makePose({ [LM.L_KNEE]: [436, 520], [LM.L_HIP]: [436, 520] });
    const rep = computeAngleReport(p, "squat", { view: "side" });
    expect(get(rep, "knee_angle").status).toBe("unmeasurable");
    expect(get(rep, "knee_angle").note).toMatch(/Couldn't measure/);
  });
});

describe("bench press", () => {
  it("bench-flare fixture → abduction ≈ 85 ± 2 (3D world landmarks)", () => {
    const r = computeAngleReport(benchFront({ flareL: 85, flareR: 70 }), "bench_press");
    expect(r.view).toBe("front");
    const m = get(r, "elbow_flare");
    expect(Math.abs(m.value! - 85)).toBeLessThanOrEqual(2);
    expect(m.points).toEqual([LM.L_ELBOW, LM.L_SHOULDER, LM.L_HIP]);
    expect(r.violations[0].ruleId).toBe("bench_elbow_flare");
    expect(r.violations[0].basis).toBe("literature");
  });
  it("falls back to 2D when worldLandmarks are missing", () => {
    const p = benchFront({ flareL: 88 });
    const r = computeAngleReport({ ...p, worldLandmarks: [] }, "bench_press");
    expect(get(r, "elbow_flare").value!).toBeCloseTo(88, 0);
  });
  it("3D depth is used when present", () => {
    const p = benchFront({ flareL: 60 });
    const w = p.worldLandmarks.map((l) => ({ ...l }));
    w[LM.L_ELBOW] = { ...w[LM.L_ELBOW], z: 0.3 };
    w[LM.R_ELBOW] = { ...w[LM.R_ELBOW], z: 0.3 };
    const r = computeAngleReport({ ...p, worldLandmarks: w }, "bench_press");
    expect(get(r, "elbow_flare").value!).not.toBeCloseTo(60, 0);
  });
  it("over-tucking below 45° is also flagged", () => {
    const r = computeAngleReport(benchFront({ flareL: 30 }), "bench_press");
    expect(get(r, "elbow_flare").status).toBe("bad");
  });
  it("one hidden arm still measures from the visible side", () => {
    const p = withVisibility(benchFront({ flareL: 85, flareR: 60 }), [LM.L_ELBOW], 0.1);
    const m = get(computeAngleReport(p, "bench_press"), "elbow_flare");
    expect(m.reliable).toBe(true);
    expect(m.value!).toBeCloseTo(60, 0);
  });
  it("both arms hidden → unmeasurable", () => {
    const p = withVisibility(benchFront({ flareL: 85 }), [LM.L_ELBOW, LM.R_ELBOW], 0.1);
    expect(get(computeAngleReport(p, "bench_press"), "elbow_flare").status).toBe("unmeasurable");
  });
  it("side view measures forearm verticality", () => {
    const sh = { x: 500, y: 500 };
    const el = { x: 520, y: 600 };
    const wr = seg(el, 30, 100);
    const p = makePose({
      [LM.L_SHOULDER]: [sh.x, sh.y],
      [LM.R_SHOULDER]: [sh.x + 5, sh.y, 0.2],
      [LM.L_HIP]: [200, 520],
      [LM.R_HIP]: [205, 520, 0.2],
      [LM.L_ELBOW]: [el.x, el.y],
      [LM.L_WRIST]: [wr.x, wr.y],
      [LM.R_KNEE]: [0, 0, 0.1],
      [LM.R_ANKLE]: [0, 0, 0.1],
    });
    const r = computeAngleReport(p, "bench_press");
    expect(r.view).toBe("side");
    expect(get(r, "forearm_vertical").value!).toBeCloseTo(30, 0);
    expect(get(r, "elbow_flare").status).toBe("unmeasurable");
  });
});

describe("pull-up", () => {
  it("good top position: no violations", () => {
    const r = computeAngleReport(pullUp({ elbowL: 55 }), "pull_up");
    expect(r.view).toBe("front");
    expect(r.side).toBe("both");
    expect(get(r, "elbow_top").value!).toBeCloseTo(55, 0);
    expect(get(r, "chin_clearance").value!).toBeGreaterThan(0.15);
    expect(r.violations).toEqual([]);
    expect(r.grade).toBe("A");
  });
  it("partial rep with kicking knees from behind (nose hidden)", () => {
    const r = computeAngleReport(pullUp({ elbowL: 100, knee: 125, noseVis: 0.2 }), "pull_up");
    expect(get(r, "elbow_top").value!).toBeCloseTo(100, 0);
    expect(get(r, "knee_angle").value!).toBeCloseTo(125, 0);
    const chin = get(r, "chin_clearance");
    expect(chin.value!).toBeLessThan(0);
    expect(chin.note).toMatch(/ears/);
    expect(r.violations.map((v) => v.ruleId)).toEqual(
      expect.arrayContaining(["pullup_top_elbow", "pullup_knee_kick", "pullup_chin_clear"]),
    );
    expect(r.violations[0].ruleId).toBe("pullup_top_elbow");
    expect(r.grade).toBe("D");
  });
  it("worse side is reported: elbow max, knee min; asymmetry and tilt flagged", () => {
    const r = computeAngleReport(pullUp({ elbowL: 60, elbowR: 95 }), "pull_up");
    const e = get(r, "elbow_top");
    expect(e.value!).toBeCloseTo(95, 0);
    expect(e.points).toEqual([LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
    expect(get(r, "elbow_asym").value!).toBeCloseTo(35, 0);
    expect(get(r, "shoulder_tilt").value!).toBeGreaterThan(6);
    const ids = r.violations.map((v) => v.ruleId);
    expect(ids).toContain("pullup_elbow_sym");
    expect(ids).toContain("pullup_shoulder_level");
  });
  it("body sway is measured against torso length", () => {
    const r = computeAngleReport(pullUp({ elbowL: 55, hipShiftX: 100 }), "pull_up");
    expect(get(r, "body_sway").value!).toBeCloseTo(0.4, 1);
    expect(r.violations[0].ruleId).toBe("pullup_sway");
  });
  it("nose visible → chin clearance from the nose", () => {
    const r = computeAngleReport(pullUp({ elbowL: 55 }), "pull_up");
    expect(get(r, "chin_clearance").note).toBeUndefined();
  });
  it("side-filmed pull-up still measures the elbow, gates front-only metrics", () => {
    const r = computeAngleReport(pullUp({ elbowL: 100 }), "pull_up", { view: "side" });
    expect(get(r, "elbow_top").status).toBe("bad");
    expect(get(r, "shoulder_tilt").status).toBe("unmeasurable");
    expect(get(r, "shoulder_tilt").note).toMatch(/in front or behind/);
  });
});

describe("other exercises", () => {
  // Side-view standing lifter facing +x (left side near).
  const standing = (o: { torso?: number; hip?: number; elbow?: number; upperArm?: number; wristDx?: number; earLean?: number }) => {
    const ankle = { x: 500, y: 920 };
    const knee = seg(ankle, 0, 200);
    const hip = seg(knee, 0, 200);
    const shoulder = seg(hip, o.torso ?? 0, 270);
    const ear = seg(shoulder, (o.torso ?? 0) + (o.earLean ?? 0), 80);
    const elbow = seg(shoulder, 180 + (o.upperArm ?? 0), 130);
    const wrist = armAt(elbow, shoulder, o.elbow ?? 175, 120, -1);
    const pts = {
      [LM.L_ANKLE]: [ankle.x, ankle.y],
      [LM.L_KNEE]: [knee.x, knee.y],
      [LM.L_HIP]: [hip.x, hip.y],
      [LM.L_SHOULDER]: [shoulder.x, shoulder.y],
      [LM.L_EAR]: [ear.x, ear.y],
      [LM.NOSE]: [ear.x + 20, ear.y + 5],
      [LM.L_ELBOW]: [elbow.x, elbow.y],
      [LM.L_WRIST]: [wrist.x + (o.wristDx ?? 0), wrist.y],
      [LM.L_HEEL]: [480, 935],
      [LM.L_FOOT]: [560, 935],
      [LM.R_ANKLE]: [ankle.x + 4, ankle.y, 0.2],
      [LM.R_KNEE]: [knee.x + 4, knee.y, 0.2],
      [LM.R_HIP]: [hip.x + 4, hip.y, 0.2],
      [LM.R_SHOULDER]: [shoulder.x + 4, shoulder.y, 0.2],
    } as Record<number, [number, number] | [number, number, number]>;
    return makePose(pts);
  };

  it("deadlift lockout: leaning back is flagged, hip angle measured", () => {
    const r = computeAngleReport(standing({ torso: -15 }), "deadlift");
    expect(r.view).toBe("side");
    expect(get(r, "torso_lean_back").value!).toBeCloseTo(15, 0);
    expect(get(r, "hip_angle").value!).toBeCloseTo(165, 0);
    expect(r.violations.map((v) => v.ruleId)).toEqual(expect.arrayContaining(["deadlift_hyperextension", "deadlift_lockout"]));
    expect(r.angles.some((a) => a.key === "back_angle")).toBe(false);
  });
  it("deadlift setup phase: back angle from horizontal; rounding severity capped", () => {
    const r = computeAngleReport(standing({ torso: 75, earLean: 60 }), "deadlift");
    expect(get(r, "back_angle").value!).toBeCloseTo(15, 0);
    expect(r.angles.some((a) => a.key === "hip_angle")).toBe(false);
    const round = r.violations.find((v) => v.ruleId === "deadlift_rounding")!;
    expect(get(r, "back_rounding").value!).toBeCloseTo(60, 0);
    expect(round.severity).toBe(3);
  });
  it("deadlift bar path offset in foot lengths", () => {
    const r = computeAngleReport(standing({ wristDx: 80 }), "deadlift", { phase: "lockout" });
    expect(get(r, "bar_path").value!).toBeGreaterThan(0.4);
    expect(r.violations.map((v) => v.ruleId)).toContain("deadlift_bar_path");
  });
  it("overhead press lockout: soft elbows, lean back and bar forward", () => {
    const r = computeAngleReport(standing({ torso: -12, upperArm: 180, elbow: 150 }), "overhead_press");
    expect(get(r, "elbow_angle").value!).toBeCloseTo(150, 0);
    expect(get(r, "torso_lean_back").value!).toBeCloseTo(12, 0);
    const ids = r.violations.map((v) => v.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["ohp_elbow_lockout", "ohp_lean_back", "ohp_wrist_stack"]));
  });
  it("biceps curl: top phase drift + swing; bottom phase ROM", () => {
    const top = computeAngleReport(standing({ torso: -14, upperArm: -30, elbow: 70 }), "biceps_curl");
    expect(get(top, "upper_arm_drift").value!).toBeCloseTo(30, 0);
    expect(top.violations.map((v) => v.ruleId)).toEqual(
      expect.arrayContaining(["curl_elbow_drift", "curl_torso_swing", "curl_top_rom"]),
    );
    const bottom = computeAngleReport(standing({ elbow: 130 }), "biceps_curl");
    expect(bottom.angles.find((a) => a.ruleId === "curl_bottom_rom")!.status).toBe("bad");
    expect(bottom.angles.some((a) => a.ruleId === "curl_top_rom")).toBe(false);
  });
  it("phase can be forced", () => {
    const r = computeAngleReport(standing({ elbow: 130 }), "biceps_curl", { phase: "top" });
    expect(r.angles.some((a) => a.ruleId === "curl_top_rom")).toBe(true);
  });
});

describe("computeMetric & completeness", () => {
  it("every rule has a metric definition", () => {
    for (const ex of EXERCISES) {
      for (const rule of RULES[ex]) expect(METRICS[ex][rule.angleKey], `${ex}.${rule.angleKey}`).toBeDefined();
    }
  });
  it("every exercise yields a schema-valid report on a neutral pose", () => {
    for (const ex of EXERCISES) {
      const r = computeAngleReport(makePose({}), ex);
      expect(r.exercise).toBe(ex);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      for (const a of r.angles) expect(() => AngleMeasurementSchema.parse(a)).not.toThrow();
    }
  });
  it("computeMetric returns the raw value or null for unknown keys", () => {
    const p = sideSquat({ knee: 115, tibia: 25, torso: 47 });
    expect(computeMetric(p, "squat", "knee_angle")!).toBeCloseTo(115, 6);
    expect(computeMetric(p, "squat", "nope")).toBeNull();
  });
});
