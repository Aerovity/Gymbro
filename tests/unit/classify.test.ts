import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HORIZONTAL_MIN_DEG, classifyExercise, frameFeatures } from "@/lib/exercises/classify";
import { DETECT_FRAMES, DETECT_MIN_POSES, detectTimes } from "@/lib/moments/refine";
import { LM } from "@/lib/pose/landmarks";
import type { PoseResult } from "@/lib/types";
import { frontPushUp, makePose, pullUp, sidePushUp, withVisibility } from "../helpers/pose";

const pushReps = () => [80, 110, 140, 170, 120, 85].map((e) => sidePushUp({ elbow: e }));
const pullReps = () => [170, 120, 70, 60, 110, 165].map((e) => pullUp({ elbowL: e }));

describe("frameFeatures", () => {
  it("horizontal push-up vs hanging pull-up", () => {
    const p = frameFeatures(sidePushUp({ elbow: 90 }));
    expect(p.torsoIncl!).toBeGreaterThan(70);
    expect(p.handsBelowShoulders).toBe(true);
    expect(p.handsAboveShoulders).toBe(false);
    const h = frameFeatures(pullUp({ elbowL: 160 }));
    expect(h.torsoIncl!).toBeLessThan(10);
    expect(h.handsAboveHead).toBe(true);
    expect(h.handsAboveShoulders).toBe(true);
    expect(h.torsoForeshortened).toBe(false);
  });
  it("inclination is measured in pixels, not normalised coordinates", () => {
    // Same normalised landmarks: torso dx = dy = 0.3 of the frame.
    const lm = (W: number, H: number): PoseResult =>
      makePose(
        {
          [LM.L_SHOULDER]: [0.6 * W, 0.3 * H],
          [LM.R_SHOULDER]: [0.6 * W, 0.3 * H],
          [LM.L_HIP]: [0.3 * W, 0.6 * H],
          [LM.R_HIP]: [0.3 * W, 0.6 * H],
        },
        { W, H },
      );
    expect(frameFeatures(lm(1280, 720)).torsoIncl!).toBeGreaterThan(HORIZONTAL_MIN_DEG); // ≈ 61°
    expect(frameFeatures(lm(720, 1280)).torsoIncl!).toBeLessThan(35); // ≈ 29°
  });
  it("hidden landmarks give unknown features", () => {
    const f = frameFeatures(withVisibility(sidePushUp({ elbow: 90 }), [LM.L_WRIST, LM.R_WRIST], 0.1));
    expect(f.handsBelowShoulders).toBeNull();
    expect(f.torsoIncl).not.toBeNull();
    expect(frameFeatures({ landmarks: [], worldLandmarks: [], width: 1, height: 1 }).torsoIncl).toBeNull();
  });
});

describe("classifyExercise", () => {
  it("side-view push-up set → push_up, high confidence", () => {
    const g = classifyExercise(pushReps());
    expect(g.exercise).toBe("push_up");
    expect(g.confidence).toBeGreaterThanOrEqual(0.85);
    expect(g.reason).toBe("body horizontal, hands on the floor");
  });
  it("either facing direction and a portrait frame", () => {
    expect(classifyExercise([90, 150, 170].map((e) => sidePushUp({ elbow: e, facing: -1, side: "right" }))).exercise).toBe("push_up");
    expect(classifyExercise([90, 150, 170].map((e) => sidePushUp({ elbow: e, W: 1600, H: 900 }))).exercise).toBe("push_up");
  });
  it("pull-up set (rear view, face hidden) → pull_up, high confidence", () => {
    const g = classifyExercise(pullReps());
    expect(g.exercise).toBe("pull_up");
    expect(g.confidence).toBeGreaterThanOrEqual(0.85);
    expect(g.reason).toBe("hanging from a bar, hands above head");
    const rear = classifyExercise([170, 90, 60].map((e) => pullUp({ elbowL: e, noseVis: 0.1 })));
    expect(rear.exercise).toBe("pull_up");
    expect(rear.confidence).toBeGreaterThanOrEqual(0.75);
  });
  it("front-view push-up (torso pointing at the camera) is still a push-up", () => {
    const g = classifyExercise([45, 60, 80].map((f) => frontPushUp({ flare: f })));
    expect(g.exercise).toBe("push_up");
    expect(g.confidence).toBeGreaterThan(0.6);
    expect(g.reason).toMatch(/hands on the floor/);
  });
  it("uses the median: a couple of bad frames don't flip a push-up set", () => {
    const frames = [...pushReps(), pullUp({ elbowL: 120 }), pullUp({ elbowL: 90 })];
    expect(classifyExercise(frames).exercise).toBe("push_up");
  });
  it("ambiguous body → nearest features at lower confidence", () => {
    // Standing, arms by the sides: upright but not hanging.
    const g = classifyExercise([makePose({}), makePose({}), makePose({})]);
    expect(g.exercise).toBe("pull_up");
    expect(g.confidence).toBeLessThanOrEqual(0.6);
    expect(g.reason).toBe("body upright");
  });
  it("nothing visible → very low confidence, never a confident pull-up", () => {
    const hidden = withVisibility(makePose({}), Array.from({ length: 33 }, (_, i) => i), 0);
    const g = classifyExercise([hidden, hidden, hidden]);
    expect(g.confidence).toBeLessThanOrEqual(0.2);
    expect(g.exercise).not.toBe("pull_up");
  });
  it("returns only offered exercises", () => {
    for (const set of [pushReps(), pullReps(), [makePose({})]]) {
      expect(["push_up", "pull_up"]).toContain(classifyExercise(set).exercise);
    }
  });
});

describe("detectExercise sampling", () => {
  it("~8 evenly spaced frame-centre times in the 5–85% window (skips set-up and the stand-up at the end)", () => {
    const ts = detectTimes(16);
    expect(DETECT_FRAMES).toBe(8);
    expect(DETECT_MIN_POSES).toBe(3);
    expect(ts).toHaveLength(8);
    const d = 15.95;
    const step = (d * 0.8) / 8;
    expect(ts[0]).toBeCloseTo(d * 0.05 + step / 2, 2);
    expect(ts[7]).toBeCloseTo(d * 0.85 - step / 2, 2);
    expect(ts[7]).toBeLessThan(d * 0.85);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeCloseTo(step, 2);
    expect(detectTimes(0).every((t) => t === 0)).toBe(true);
    expect(detectTimes(NaN)).toHaveLength(8);
  });
});

describe("classifyExercise on real MediaPipe poses (calibration clips)", () => {
  const load = (f: string) => JSON.parse(readFileSync(resolve("tests/fixtures", f), "utf8")) as { frames: { t: number; pose: PoseResult }[] };

  it("push-up filmed from behind at ~45° → push_up ≥ 0.6 (3D torso lean + hands below the shoulders)", () => {
    const { frames } = load("detect-pushup-real.json");
    const poses = frames.map((f) => f.pose);
    // On screen the torso only looks ~35–48° tilted, so the horizontal-body rule alone can't catch it.
    const feats = poses.map(frameFeatures);
    expect(feats.every((f) => (f.torsoIncl ?? 0) < HORIZONTAL_MIN_DEG)).toBe(true);
    expect(feats.filter((f) => (f.torsoIncl3d ?? 0) >= 40).length).toBeGreaterThanOrEqual(6);
    const g = classifyExercise(poses);
    expect(g.exercise).toBe("push_up");
    expect(g.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("real pull-up clip → pull_up, confidently", () => {
    const { frames } = load("detect-pullup-real.json");
    const g = classifyExercise(frames.map((f) => f.pose));
    expect(g.exercise).toBe("pull_up");
    expect(g.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it("standing upright with the arms down is never a confident push-up", () => {
    // The stand-up at the end of a push-up clip: torso vertical, wrists by the hips.
    const standing = makePose({ [LM.L_WRIST]: [440, 540], [LM.R_WRIST]: [560, 540] });
    const g = classifyExercise([standing, standing, standing]);
    expect(g.exercise === "pull_up" || g.confidence < 0.6).toBe(true);
  });
});
