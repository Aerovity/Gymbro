import { describe, expect, it } from "vitest";
import {
  ANCHORS,
  angle3,
  bodyLineOffset,
  correctPose,
  correctSequence,
  correctionsFrom,
  exerciseCameraHint,
  faultJoints,
  pushElbowAngle,
  setPushupElbow,
  solveElbow,
  lerpPose,
  levelFloorContacts,
  phaseWeight,
  prepare3D,
  rotateAboutAxis,
  sampleSequence,
  setJointAngle3,
  smoothFrames,
  toScene,
  type V3,
} from "@/lib/pose3d/skeleton3d";
import { LM } from "@/lib/pose/landmarks";
import type { AngleReport, Landmark } from "@/lib/types";
import { computeAngleReport } from "@/lib/angles/compute";
import { plank3D, sidePushUp } from "../helpers/pose";

const lm = (x: number, y: number, z = 0): Landmark => ({ x, y, z, visibility: 1 });

/** A T-ish standing body in MediaPipe world space (y down). */
function body(): Landmark[] {
  const w: Landmark[] = Array.from({ length: 33 }, () => lm(0, -0.6));
  w[LM.NOSE] = lm(0, -0.75);
  w[LM.L_EAR] = lm(0.06, -0.72);
  w[LM.R_EAR] = lm(-0.06, -0.72);
  w[LM.L_SHOULDER] = lm(0.18, -0.5);
  w[LM.R_SHOULDER] = lm(-0.18, -0.5);
  w[LM.L_ELBOW] = lm(0.2, -0.2);
  w[LM.R_ELBOW] = lm(-0.2, -0.2);
  w[LM.L_WRIST] = lm(0.2, 0.05);
  w[LM.R_WRIST] = lm(-0.2, 0.05);
  w[LM.L_HIP] = lm(0.1, 0);
  w[LM.R_HIP] = lm(-0.1, 0);
  w[LM.L_KNEE] = lm(0.1, 0.45);
  w[LM.R_KNEE] = lm(-0.1, 0.45);
  w[LM.L_ANKLE] = lm(0.1, 0.9);
  w[LM.R_ANKLE] = lm(-0.1, 0.9);
  for (const [a, b] of [[LM.L_HEEL, LM.L_ANKLE], [LM.R_HEEL, LM.R_ANKLE], [LM.L_FOOT, LM.L_ANKLE], [LM.R_FOOT, LM.R_ANKLE]]) w[a] = lm(w[b].x, 0.95, -0.05);
  for (const [a, b] of [[LM.L_PINKY, LM.L_WRIST], [LM.L_INDEX, LM.L_WRIST], [LM.L_THUMB, LM.L_WRIST], [LM.R_PINKY, LM.R_WRIST], [LM.R_INDEX, LM.R_WRIST], [LM.R_THUMB, LM.R_WRIST]]) w[a] = lm(w[b].x, 0.1);
  return w;
}

const report = (over: Partial<AngleReport> = {}): AngleReport => ({
  exercise: "pull_up",
  view: "front",
  side: "both",
  angles: [],
  violations: [],
  score: 90,
  grade: "A",
  ...over,
});

describe("3D math", () => {
  it("angle3 of a right angle and degenerate input", () => {
    expect(angle3([1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeCloseTo(90, 6);
    expect(angle3([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
  });

  it("rotateAboutAxis rotates 90° about z", () => {
    const p = rotateAboutAxis([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(1, 6);
  });

  it("toScene flips y and z", () => {
    expect(toScene([lm(1, 2, 3)])[0]).toEqual([1, -2, -3]);
  });

  it("setJointAngle3 hits the target and preserves segment length", () => {
    const pts = toScene(body());
    const before = Math.hypot(...(pts[LM.L_WRIST].map((v, i) => v - pts[LM.L_ELBOW][i]) as V3));
    // bend the left elbow (nearly straight) to 90°
    pts[LM.L_WRIST] = [0.21, -0.05, -0.05];
    expect(setJointAngle3(pts, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], 90)).toBe(true);
    expect(angle3(pts[LM.L_SHOULDER], pts[LM.L_ELBOW], pts[LM.L_WRIST])).toBeCloseTo(90, 4);
    const after = Math.hypot(...(pts[LM.L_WRIST].map((v, i) => v - pts[LM.L_ELBOW][i]) as V3));
    expect(after).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it("smoothing, lerp and sequence sampling", () => {
    const a: V3[] = [[0, 0, 0]];
    const b: V3[] = [[3, 0, 0]];
    const c: V3[] = [[0, 0, 0]];
    expect(smoothFrames([a, b, c])[1][0][0]).toBeCloseTo(1, 6);
    expect(lerpPose(a, b, 0.5)[0][0]).toBeCloseTo(1.5, 6);
    expect(sampleSequence([a, b], [0, 1], 0.25)[0][0]).toBeCloseTo(0.75, 6);
    expect(sampleSequence([a, b], [0, 1], 5)[0][0]).toBe(3);
    expect(phaseWeight(2, 2)).toBe(1);
    expect(phaseWeight(3, 2)).toBeLessThan(0.05);
  });
});

describe("corrections", () => {
  it("levels tilted shoulders and keeps the hands anchored", () => {
    const w = body();
    w[LM.L_SHOULDER] = lm(0.18, -0.58); // left shoulder hiked up
    const r = report({
      violations: [{ ruleId: "pullup_shoulder_level", label: "Shoulder tilt", angleKey: "shoulder_tilt", actual: 12, target: { max: 6, ideal: 0 }, deviation: 6, severity: 3, cue: "", basis: "heuristic" }],
    });
    const corr = correctionsFrom(r);
    expect(corr[0].kind).toBe("level-shoulders");
    const pts = toScene(w);
    const anchor = [LM.L_WRIST, LM.R_WRIST];
    const out = correctPose(pts, corr, 1, 1, anchor);
    const tilt = (p: V3[]) => Math.abs(p[LM.L_SHOULDER][1] - p[LM.R_SHOULDER][1]);
    expect(tilt(out)).toBeLessThan(tilt(pts) * 0.1);
    const mid = (p: V3[]) => (p[LM.L_WRIST][1] + p[LM.R_WRIST][1]) / 2;
    expect(mid(out)).toBeCloseTo(mid(pts), 6);
  });

  it("joint correction only moves angles that are outside the target, on both sides", () => {
    const pts = toScene(body());
    const r = report({
      angles: [{ key: "elbow_top", label: "Elbow", value: 170, unit: "°", points: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST], reliable: true, status: "bad", deviation: 95, target: { max: 75, ideal: 60 } }],
      violations: [{ ruleId: "pullup_top_elbow", label: "Elbow", angleKey: "elbow_top", actual: 170, target: { max: 75, ideal: 60 }, deviation: 95, severity: 5, cue: "", basis: "heuristic" }],
    });
    const out = correctPose(pts, correctionsFrom(r), 1, 1);
    expect(angle3(out[LM.R_SHOULDER], out[LM.R_ELBOW], out[LM.R_WRIST])).toBeCloseTo(60, 3);
    expect(angle3(out[LM.L_SHOULDER], out[LM.L_ELBOW], out[LM.L_WRIST])).toBeCloseTo(60, 3);
    // zero local weight → unchanged
    const none = correctPose(pts, correctionsFrom(r), 1, 0);
    expect(none[LM.R_WRIST]).toEqual(pts[LM.R_WRIST]);
  });

  it("prepare3D builds you/target sequences standing on the floor", () => {
    const frames = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ t, world: body() }));
    const p = prepare3D(frames, undefined, report(), 0.2)!;
    expect(p.you).toHaveLength(5);
    expect(p.target).toHaveLength(5);
    const minY = Math.min(...p.you.flat().map((v) => v[1]));
    expect(minY).toBeCloseTo(0, 6);
    expect(prepare3D(undefined, body(), report(), 1)!.you).toHaveLength(1);
    expect(prepare3D(undefined, undefined, report(), 1)).toBeNull();
  });
});

describe("push-up corrections", () => {
  const anchor = ANCHORS.push_up;
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const expectAnchored = (before: V3[], after: V3[]) => {
    for (const i of anchor) expect(dist(before[i], after[i])).toBeCloseTo(0, 9);
  };
  const pushReport = (...specs: Parameters<typeof sidePushUp>[0][]) => specs.map((s) => computeAngleReport(sidePushUp(s), "push_up"));

  it("anchors: hands and toes; side camera", () => {
    expect(anchor).toEqual([LM.L_WRIST, LM.R_WRIST, LM.L_FOOT, LM.R_FOOT]);
    expect(exerciseCameraHint.push_up).toBe("side");
  });

  it("body-line correction straightens a sagging plank, anchors and shoulders stay put", () => {
    const [r] = pushReport({ elbow: 80, hipOffset: 0.3 });
    const corr = correctionsFrom(r);
    expect(corr).toEqual([{ kind: "body-line", key: "body_line", local: false }]);
    const pts = toScene(plank3D({ elbow: 90, sag: 0.3 }));
    expect(bodyLineOffset(pts)).toBeGreaterThan(0.25);
    const out = correctPose(pts, corr, 1, 1, anchor);
    expect(bodyLineOffset(out)).toBeLessThan(1e-6);
    expect(angle3(out[LM.L_SHOULDER], out[LM.L_HIP], out[LM.L_ANKLE])!).toBeCloseTo(180, 4);
    expect(angle3(out[LM.L_HIP], out[LM.L_KNEE], out[LM.L_ANKLE])!).toBeCloseTo(180, 4);
    expectAnchored(pts, out);
    expect(dist(pts[LM.L_SHOULDER], out[LM.L_SHOULDER])).toBeCloseTo(0, 9);
    // Hips move up (scene y up) for a sag; a pike comes down.
    expect(out[LM.L_HIP][1]).toBeGreaterThan(pts[LM.L_HIP][1]);
    const pike = toScene(plank3D({ elbow: 90, sag: -0.3 }));
    const fixed = correctPose(pike, corr, 1, 1, anchor);
    expect(fixed[LM.L_HIP][1]).toBeLessThan(pike[LM.L_HIP][1]);
    expect(bodyLineOffset(fixed)).toBeLessThan(1e-6);
    // Half strength → half way.
    expect(bodyLineOffset(correctPose(pts, corr, 0.5, 0.5, anchor))).toBeCloseTo(bodyLineOffset(pts) / 2, 2);
  });

  it("depth correction lowers the chest until the elbows reach the target, hands planted", () => {
    const [r] = pushReport({ elbow: 125 });
    const corr = correctionsFrom(r);
    expect(corr).toEqual([{ kind: "push-depth", key: "elbow_bottom", ideal: 80, phase: "bottom", local: true }]);
    const pts = toScene(plank3D({ elbow: 130 }));
    const out = correctPose(pts, corr, 1, 1, anchor);
    expect(pushElbowAngle(out)!).toBeCloseTo(80, 3);
    expect(angle3(out[LM.L_SHOULDER], out[LM.L_ELBOW], out[LM.L_WRIST])!).toBeCloseTo(80, 3);
    expect(angle3(out[LM.R_SHOULDER], out[LM.R_ELBOW], out[LM.R_WRIST])!).toBeCloseTo(80, 3);
    expect(out[LM.L_SHOULDER][1]).toBeLessThan(pts[LM.L_SHOULDER][1]);
    expect(out[LM.L_SHOULDER][1]).toBeGreaterThan(0); // above the floor
    expectAnchored(pts, out);
    for (const [a, b] of [[LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST], [LM.L_SHOULDER, LM.L_HIP], [LM.L_HIP, LM.L_KNEE]]) {
      expect(dist(out[a], out[b])).toBeCloseTo(dist(pts[a], pts[b]), 9);
    }
    // Zero phase weight → unchanged; already deep enough → unchanged.
    expect(correctPose(pts, corr, 1, 0, anchor)).toEqual(pts);
    const deep = toScene(plank3D({ elbow: 75 }));
    expect(pushElbowAngle(correctPose(deep, corr, 1, 1, anchor))!).toBeCloseTo(75, 6);
  });

  it("lockout correction raises the body to straight arms", () => {
    const [r] = pushReport({ elbow: 152 });
    const corr = correctionsFrom(r);
    expect(corr[0]).toMatchObject({ kind: "push-depth", key: "elbow_top", phase: "top", ideal: 172 });
    const pts = toScene(plank3D({ elbow: 150 }));
    const out = correctPose(pts, corr, 1, 1, anchor);
    expect(pushElbowAngle(out)!).toBeCloseTo(172, 3);
    expect(out[LM.L_SHOULDER][1]).toBeGreaterThan(pts[LM.L_SHOULDER][1]);
    expectAnchored(pts, out);
  });

  it("over a whole rep the range is rescaled: top frames stay, the flagged bottom reaches the ideal", () => {
    const [r] = pushReport({ elbow: 125, hipOffset: 0.3 });
    const corr = correctionsFrom(r);
    expect(corr.map((c) => c.kind).sort()).toEqual(["body-line", "push-depth"]);
    const angles = [170, 150, 130, 150, 170];
    const times = [0, 0.3, 0.6, 0.9, 1.2];
    const frames = angles.map((e) => toScene(plank3D({ elbow: e, sag: 0.3 })));
    const seq = correctSequence(frames, times, corr, 0.6, anchor);
    const out = seq.map((f) => pushElbowAngle(f)!);
    expect(out[0]).toBeCloseTo(170, 3);
    expect(out[4]).toBeCloseTo(170, 3);
    expect(out[2]).toBeCloseTo(80, 3);
    expect(out[1]).toBeLessThan(150);
    expect(out[1]).toBeGreaterThan(80);
    seq.forEach((f, i) => {
      expect(bodyLineOffset(f)).toBeLessThan(1e-6);
      expectAnchored(frames[i], f);
    });
  });

  it("prepare3D: corrected push-up keeps the hands and toes where the user's are", () => {
    const [r] = pushReport({ elbow: 125, hipOffset: 0.3 });
    const times = [0, 0.3, 0.6, 0.9, 1.2];
    const frames = [170, 150, 130, 150, 170].map((e, i) => ({ t: times[i], world: plank3D({ elbow: e, sag: 0.3 }) }));
    const p = prepare3D(frames, undefined, r, 0.6)!;
    p.target.forEach((f, i) => expectAnchored(p.you[i], f));
    expect(Math.min(...p.you.flat().map((v) => v[1]))).toBeCloseTo(0, 6);
    expect([...p.faultJoints].sort((a, b) => a - b)).toEqual([LM.L_ELBOW, LM.R_ELBOW, LM.L_HIP, LM.R_HIP]);
  });

  it("fault joints: body line → hips, head line → ears + shoulders, elbow metrics → elbows", () => {
    const [sag, head] = pushReport({ elbow: 80, hipOffset: 0.3 }, { elbow: 80, neck: 135 });
    expect(faultJoints(sag)).toEqual([LM.L_HIP, LM.R_HIP]);
    expect(faultJoints(head).sort((a, b) => a - b)).toEqual([LM.L_EAR, LM.R_EAR, LM.L_SHOULDER, LM.R_SHOULDER]);
    const flare = report({
      exercise: "push_up",
      violations: [{ ruleId: "pushup_elbow_flare", label: "Elbow flare", angleKey: "elbow_flare", actual: 80, target: { max: 60, ideal: 45 }, deviation: 20, severity: 3, cue: "", basis: "heuristic" }],
    });
    expect(faultJoints(flare)).toEqual([LM.L_ELBOW, LM.R_ELBOW]);
  });

  it("elbow tuck (front view) swings the elbows in about the shoulder→wrist axis", () => {
    const pts = toScene(plank3D({ elbow: 90 }));
    const axisL: V3 = [0, 1, 2].map((k) => pts[LM.L_WRIST][k] - pts[LM.L_SHOULDER][k]) as V3;
    const flared = pts.map((p) => [...p] as V3);
    const flareOf = (e: V3) => angle3(e, pts[LM.L_SHOULDER], pts[LM.L_HIP])!;
    // Swing the left elbow out to its widest position first.
    flared[LM.L_ELBOW] = [-1.5, -1, 1, 1.5]
      .map((rad) => rotateAboutAxis(pts[LM.L_ELBOW], pts[LM.L_SHOULDER], axisL, rad))
      .sort((a, b) => flareOf(b) - flareOf(a))[0];
    const flare = (p: V3[]) => angle3(p[LM.L_ELBOW], p[LM.L_SHOULDER], p[LM.L_HIP])!;
    const corr = correctionsFrom(
      report({
        exercise: "push_up",
        violations: [{ ruleId: "pushup_elbow_flare", label: "Elbow flare", angleKey: "elbow_flare", actual: flare(flared), target: { max: 60, ideal: 45 }, deviation: 10, severity: 2, cue: "", basis: "heuristic" }],
      }),
    );
    expect(corr[0].kind).toBe("elbow-tuck");
    expect(flare(flared)).toBeGreaterThan(60);
    const out = correctPose(flared, corr, 1, 1, anchor);
    expect(flare(out)).toBeLessThan(flare(flared));
    expect(dist(out[LM.L_ELBOW], out[LM.L_SHOULDER])).toBeCloseTo(dist(flared[LM.L_ELBOW], flared[LM.L_SHOULDER]), 9);
    expect(dist(out[LM.L_ELBOW], out[LM.L_WRIST])).toBeCloseTo(dist(flared[LM.L_ELBOW], flared[LM.L_WRIST]), 9);
    expectAnchored(flared, out);
  });

  it("helpers: two-bone IK and degenerate input", () => {
    const e = solveElbow([0, 0, 0], [0.4, 0, 0], [0.2, 1, 0], 0.28, 0.26);
    expect(dist(e, [0, 0, 0])).toBeCloseTo(0.28, 9);
    expect(dist(e, [0.4, 0, 0])).toBeCloseTo(0.26, 9);
    expect(e[1]).toBeGreaterThan(0); // bends toward the hint
    const flat: V3[] = Array.from({ length: 33 }, () => [0, 0, 0] as V3);
    expect(setPushupElbow(flat, 90)).toBe(false);
    expect(pushElbowAngle(flat)).toBeNull();
  });
});

describe("levelFloorContacts (push-up filmed by a tilted phone)", () => {
  const handsMinusFeet = (f: V3[]) => {
    const h = [(f[LM.L_WRIST][0] + f[LM.R_WRIST][0]) / 2, (f[LM.L_WRIST][1] + f[LM.R_WRIST][1]) / 2] as const;
    const t = [(f[LM.L_FOOT][0] + f[LM.R_FOOT][0]) / 2, (f[LM.L_FOOT][1] + f[LM.R_FOOT][1]) / 2] as const;
    return [h[0] - t[0], h[1] - t[1]] as const;
  };
  it("rotates a camera-pitched plank back to level, hands and feet on one floor plane", () => {
    const flat = toScene(plank3D({ elbow: 90 }));
    const [, dy0] = handsMinusFeet(flat);
    expect(Math.abs(dy0)).toBeLessThan(0.05);
    // The phone pitched 35°: the plank comes out as an incline.
    const tilted = flat.map((p) => rotateAboutAxis(p, [0, 0, 0], [0, 0, 1], (35 * Math.PI) / 180));
    const [, dyT] = handsMinusFeet(tilted);
    expect(Math.abs(dyT)).toBeGreaterThan(0.3);
    const [lev] = levelFloorContacts([tilted, tilted]);
    const [dx, dy] = handsMinusFeet(lev);
    expect(Math.abs(dy)).toBeLessThan(0.02);
    expect(Math.abs(dx)).toBeGreaterThan(0.5);
    // Body shape is unchanged (rigid rotation).
    expect(angle3(lev[LM.L_SHOULDER], lev[LM.L_ELBOW], lev[LM.L_WRIST])!).toBeCloseTo(angle3(flat[LM.L_SHOULDER], flat[LM.L_ELBOW], flat[LM.L_WRIST])!, 3);
  });
  it("leaves an already level plank alone", () => {
    const flat = toScene(plank3D({ elbow: 160 }));
    expect(levelFloorContacts([flat])[0]).toEqual(flat);
  });
});
