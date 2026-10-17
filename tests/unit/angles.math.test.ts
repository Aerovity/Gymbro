import { describe, expect, it } from "vitest";
import {
  angleAt,
  angleAt3,
  dist,
  inclinationFromVertical,
  lineTiltFromHorizontal,
  median3,
  mid,
  round,
  toPx,
} from "@/lib/angles/math";

describe("angleAt", () => {
  it("right angle (0,1)-(0,0)-(1,0) → 90°", () => {
    expect(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 9);
  });
  it("straight line → 180°", () => {
    expect(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180, 9);
  });
  it("folded back on itself → 0°", () => {
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 })).toBeCloseTo(0, 9);
  });
  it("45° and 135°", () => {
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 9);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 1 })).toBeCloseTo(135, 9);
  });
  it("coincident points → null (no NaN)", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(angleAt({ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
  it("is order-invariant (A,B,C vs C,B,A)", () => {
    const a = { x: 3, y: 7 };
    const b = { x: 1, y: 2 };
    const c = { x: -4, y: 5 };
    expect(angleAt(a, b, c)).toBeCloseTo(angleAt(c, b, a)!, 12);
  });
  it("is independent of rotation direction (always 0–180)", () => {
    const v = angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: -1, y: 0 });
    expect(v).toBeCloseTo(90, 9);
  });
});

describe("angleAt3", () => {
  it("orthogonal 3D vectors → 90°", () => {
    expect(angleAt3({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(90, 9);
  });
  it("known vectors (1,0,0)·(1,1,1) → acos(1/√3)", () => {
    const expected = (Math.acos(1 / Math.sqrt(3)) * 180) / Math.PI;
    expect(angleAt3({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBeCloseTo(expected, 9);
  });
  it("depth changes the angle vs. the 2D projection", () => {
    const a = { x: 1, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const c = { x: 1, y: 0, z: 1 };
    expect(angleAt3(a, b, c)).toBeCloseTo(45, 9);
    expect(angleAt(a, b, c)).toBeCloseTo(0, 9);
  });
  it("degenerate → null", () => {
    expect(angleAt3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBeNull();
    expect(angleAt3({ x: 0, y: 0, z: NaN }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBeNull();
  });
});

describe("inclination and tilt", () => {
  it("vertical segment → 0°, horizontal → 90°", () => {
    expect(inclinationFromVertical({ x: 5, y: 10 }, { x: 5, y: 0 })).toBeCloseTo(0, 9);
    expect(inclinationFromVertical({ x: 5, y: 0 }, { x: 5, y: 10 })).toBeCloseTo(0, 9);
    expect(inclinationFromVertical({ x: 0, y: 3 }, { x: 10, y: 3 })).toBeCloseTo(90, 9);
  });
  it("45° lean either way is 45°", () => {
    expect(inclinationFromVertical({ x: 0, y: 10 }, { x: 10, y: 0 })).toBeCloseTo(45, 9);
    expect(inclinationFromVertical({ x: 0, y: 10 }, { x: -10, y: 0 })).toBeCloseTo(45, 9);
  });
  it("line tilt from horizontal", () => {
    expect(lineTiltFromHorizontal({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 9);
    expect(lineTiltFromHorizontal({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(45, 9);
    expect(lineTiltFromHorizontal({ x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(45, 9);
    expect(lineTiltFromHorizontal({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 9);
  });
  it("degenerate → null", () => {
    expect(inclinationFromVertical({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
    expect(lineTiltFromHorizontal({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
    expect(inclinationFromVertical({ x: NaN, y: 1 }, { x: 1, y: 1 })).toBeNull();
    expect(lineTiltFromHorizontal({ x: NaN, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe("toPx / mid / dist / round", () => {
  it("pixel conversion corrects aspect: a normalised square in a 16:9 frame is a 16:9 rectangle", () => {
    const W = 1920;
    const H = 1080;
    const a = toPx({ x: 0.25, y: 0.25 }, W, H);
    const b = toPx({ x: 0.75, y: 0.25 }, W, H);
    const c = toPx({ x: 0.75, y: 0.75 }, W, H);
    expect(b.x - a.x).toBe(960);
    expect(c.y - b.y).toBe(540);
    // The normalised diagonal is 45°; in pixels it is atan(540/960).
    const diag = angleAt(c, a, b)!;
    expect(diag).toBeCloseTo((Math.atan(540 / 960) * 180) / Math.PI, 9);
    expect(diag).not.toBeCloseTo(45, 1);
  });
  it("mid and dist", () => {
    expect(mid({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual({ x: 2, y: 1 });
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it("round", () => {
    expect(round(1.2345, 2)).toBe(1.23);
    expect(round(1.5)).toBe(2);
    expect(round(-0.004, 2)).toBeCloseTo(0, 9);
  });
});

describe("median3", () => {
  it("removes single spikes", () => {
    expect(median3([10, 10, 90, 10, 10])).toEqual([10, 10, 10, 10, 10]);
  });
  it("edges use 2-tap means; nulls are skipped and preserved", () => {
    expect(median3([1, 3, 5])).toEqual([2, 3, 4]);
    expect(median3([1, null, 5])).toEqual([1, null, 5]);
    expect(median3([4])).toEqual([4]);
    expect(median3([])).toEqual([]);
    expect(median3([NaN, 2])).toEqual([null, 2]);
  });
});
