import { describe, expect, it } from "vitest";
import { computeCrop, editSizeFor, transformPose, untransformPose } from "@/lib/video/crop";
import { computeAngleReport } from "@/lib/angles/compute";
import { VISIBILITY_MIN, LM } from "@/lib/pose/landmarks";
import type { CropBox, PoseResult } from "@/lib/types";
import { makePose, pullUp, sideSquat, withVisibility } from "../helpers/pose";

function bbox(pose: PoseResult, W: number, H: number) {
  const v = pose.landmarks.filter((l) => l.visibility >= VISIBILITY_MIN);
  return {
    x0: Math.min(...v.map((l) => l.x * W)),
    x1: Math.max(...v.map((l) => l.x * W)),
    y0: Math.min(...v.map((l) => l.y * H)),
    y1: Math.max(...v.map((l) => l.y * H)),
  };
}

function expectInside(c: CropBox, W: number, H: number) {
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.y).toBeGreaterThanOrEqual(0);
  expect(c.x + c.w).toBeLessThanOrEqual(W);
  expect(c.y + c.h).toBeLessThanOrEqual(H);
  expect(c.w).toBeGreaterThan(0);
  expect(c.h).toBeGreaterThan(0);
}

describe("editSizeFor", () => {
  it("portrait / landscape / square", () => {
    expect(editSizeFor(720, 1280)).toBe("1024x1536");
    expect(editSizeFor(1920, 1080)).toBe("1536x1024");
    expect(editSizeFor(500, 500)).toBe("1024x1024");
  });
});

describe("computeCrop", () => {
  it("portrait pull-up frame → exact 2:3 output, bbox contained, inside the frame", () => {
    const pose = pullUp({ elbowL: 100 });
    const c = computeCrop(pose, 720, 1280, "pull_up");
    expect(c.size).toBe("1024x1536");
    expect([c.outW, c.outH]).toEqual([1024, 1536]);
    expect(c.outW / c.outH).toBe(2 / 3);
    expect(Math.abs(c.w / c.h - 2 / 3)).toBeLessThan(0.01);
    expectInside(c, 720, 1280);
    const b = bbox(pose, 720, 1280);
    expect(c.x).toBeLessThanOrEqual(b.x0);
    expect(c.x + c.w).toBeGreaterThanOrEqual(b.x1);
    expect(c.y).toBeLessThanOrEqual(b.y0);
    expect(c.y + c.h).toBeGreaterThanOrEqual(b.y1);
  });
  it("pull-ups get extra headroom above the hands for the bar", () => {
    const small = makePose(
      Object.fromEntries(
        pullUp({ elbowL: 100 }).landmarks.map((l, i) => [i, [l.x * 360 + 180, l.y * 640 + 320] as [number, number]]),
      ),
      { W: 720, H: 1280 },
    );
    const b = bbox(small, 720, 1280);
    const pull = computeCrop(small, 720, 1280, "pull_up");
    const squat = computeCrop(small, 720, 1280, "squat");
    expect(b.y0 - pull.y).toBeGreaterThan((b.y1 - b.y0) * 0.3);
    expect(pull.y).toBeLessThanOrEqual(squat.y);
    expectInside(pull, 720, 1280);
  });
  it("landscape frame → 3:2", () => {
    const pose = sideSquat({ knee: 100, tibia: 20, torso: 40, W: 1920, H: 1080 });
    const c = computeCrop(pose, 1920, 1080);
    expect(c.size).toBe("1536x1024");
    expect(Math.abs(c.w / c.h - 1.5)).toBeLessThan(0.01);
    expectInside(c, 1920, 1080);
  });
  it("square frame → 1:1", () => {
    const c = computeCrop(makePose({}), 1000, 1000);
    expect(c.size).toBe("1024x1024");
    expect(c.w).toBe(c.h);
    expectInside(c, 1000, 1000);
  });
  it("frame too small for the padded box → shrinks keeping the aspect, never pads", () => {
    // Person fills a landscape frame top to bottom.
    const pts = Object.fromEntries(makePose({}).landmarks.map((l, i) => [i, [l.x * 1500, l.y * 1000 - 100] as [number, number]]));
    const pose = makePose(pts, { W: 1500, H: 1000 });
    const c = computeCrop(pose, 1500, 1000, "overhead_press");
    expect(Math.abs(c.w / c.h - 1.5)).toBeLessThan(0.01);
    expectInside(c, 1500, 1000);
    expect(c.h).toBeLessThanOrEqual(1000);
  });
  it("person at the edge is clamped inside the frame", () => {
    const pts = Object.fromEntries(makePose({}).landmarks.map((l, i) => [i, [l.x * 300 + 0, l.y * 600] as [number, number]]));
    const pose = makePose(pts, { W: 1920, H: 1080 });
    const c = computeCrop(pose, 1920, 1080);
    expect(c.x).toBe(0);
    expectInside(c, 1920, 1080);
  });
  it("low-visibility points are ignored unless almost nothing is visible", () => {
    const base = makePose({});
    const withOutlier = makePose({ [LM.L_FOOT]: [5, 995, 0.1] });
    expect(computeCrop(withOutlier, 1000, 1000)).toEqual(computeCrop(withVisibility(base, [LM.L_FOOT], 0.1), 1000, 1000));
    const none = withVisibility(base, [...Array(33).keys()], 0.1);
    expectInside(computeCrop(none, 1000, 1000), 1000, 1000);
    const empty: PoseResult = { landmarks: [], worldLandmarks: [], width: 640, height: 480 };
    const c = computeCrop(empty, 640, 480);
    expectInside(c, 640, 480);
    expect(Math.abs(c.w / c.h - 1.5)).toBeLessThan(0.02);
  });
  it("arms overhead without an exercise hint also gets headroom", () => {
    const p = pullUp({ elbowL: 100 });
    expect(computeCrop(p, 720, 1280).y).toBe(computeCrop(p, 720, 1280, "pull_up").y);
  });
});

describe("transformPose", () => {
  it("maps into crop output space and round-trips", () => {
    const pose = pullUp({ elbowL: 100 });
    const c = computeCrop(pose, 720, 1280, "pull_up");
    const t = transformPose(pose, c);
    expect(t.width).toBe(c.outW);
    expect(t.height).toBe(c.outH);
    // A landmark at the crop's top-left corner maps to (0,0).
    const corner = transformPose({ ...pose, landmarks: [{ x: c.x / 720, y: c.y / 1280, z: 0, visibility: 1 }] }, c);
    expect(corner.landmarks[0].x).toBeCloseTo(0, 9);
    expect(corner.landmarks[0].y).toBeCloseTo(0, 9);
    const back = untransformPose(t, c, 720, 1280);
    back.landmarks.forEach((l, i) => {
      expect(l.x).toBeCloseTo(pose.landmarks[i].x, 9);
      expect(l.y).toBeCloseTo(pose.landmarks[i].y, 9);
      expect(l.z).toBeCloseTo(pose.landmarks[i].z, 9);
      expect(l.visibility).toBe(pose.landmarks[i].visibility);
    });
    expect(back.width).toBe(720);
  });
  it("angles are preserved through the crop (uniform scale)", () => {
    const pose = pullUp({ elbowL: 100, knee: 130 });
    const c = computeCrop(pose, 720, 1280, "pull_up");
    const a = computeAngleReport(pose, "pull_up");
    const b = computeAngleReport(transformPose(pose, c), "pull_up");
    a.angles.forEach((m, i) => {
      if (m.value === null) return;
      expect(b.angles[i].value!).toBeCloseTo(m.value, m.unit === "°" ? 0 : 1);
    });
  });
});
