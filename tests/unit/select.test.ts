import { describe, expect, it } from "vitest";
import type { Landmark } from "@/lib/types";
import { allVisible, landmarksBBox, lifterScore, meanVisibility, selectLifter, torsoBBox } from "@/lib/pose/select";

/** 33 landmarks with the torso centred at (cx, cy) and given size. */
function person(cx: number, cy: number, s: number, vis = 0.9): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility: vis }));
  lms[11] = { x: cx - s / 2, y: cy - s / 2, z: 0, visibility: vis };
  lms[12] = { x: cx + s / 2, y: cy - s / 2, z: 0, visibility: vis };
  lms[23] = { x: cx - s / 3, y: cy + s / 2, z: 0, visibility: vis };
  lms[24] = { x: cx + s / 3, y: cy + s / 2, z: 0, visibility: vis };
  return lms;
}

describe("bbox helpers", () => {
  it("computes a torso bbox", () => {
    const b = torsoBBox(person(0.5, 0.5, 0.2))!;
    expect(b.x0).toBeCloseTo(0.4);
    expect(b.x1).toBeCloseTo(0.6);
    expect(b.h).toBeCloseTo(0.2);
    expect(b.cx).toBeCloseTo(0.5);
    expect(b.area).toBeCloseTo(0.04);
  });
  it("filters by visibility and returns null when empty", () => {
    const p = person(0.5, 0.5, 0.2, 0.1);
    expect(landmarksBBox(p, [11, 12], 0.5)).toBeNull();
    expect(landmarksBBox([], undefined)).toBeNull();
    expect(landmarksBBox(p)).not.toBeNull();
  });
  it("visibility helpers", () => {
    const p = person(0.5, 0.5, 0.2, 0.6);
    expect(meanVisibility(p, [11, 12])).toBeCloseTo(0.6);
    expect(meanVisibility(p, [])).toBe(0);
    expect(allVisible(p, [11, 12])).toBe(true);
    expect(allVisible(p, [11], 0.7)).toBe(false);
  });
});

describe("selectLifter", () => {
  it("prefers the larger torso", () => {
    expect(selectLifter([person(0.5, 0.5, 0.1), person(0.5, 0.5, 0.3)])).toBe(1);
  });
  it("prefers the centred person when sizes are similar", () => {
    expect(selectLifter([person(0.9, 0.5, 0.2), person(0.52, 0.5, 0.19)])).toBe(1);
  });
  it("a centred lifter beats a slightly larger spotter at the edge", () => {
    expect(selectLifter([person(0.85, 0.6, 0.25), person(0.5, 0.45, 0.22)])).toBe(1);
  });
  it("handles no / invalid poses", () => {
    expect(selectLifter([])).toBe(-1);
    expect(selectLifter([[]])).toBe(-1);
    expect(lifterScore([])).toBe(-Infinity);
  });
});
