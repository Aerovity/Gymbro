import { describe, expect, it } from "vitest";
import {
  angle3,
  correctPose,
  correctionsFrom,
  lerpPose,
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
