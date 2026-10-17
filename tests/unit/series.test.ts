import { describe, expect, it } from "vitest";
import { argExtremum, argmax, argmin, laplacianVariance, localExtrema, median3, rgbaToGray } from "@/lib/moments/series";

describe("median3", () => {
  it("removes single spikes", () => {
    expect(median3([10, 10, 90, 10, 10])).toEqual([10, 10, 10, 10, 10]);
  });
  it("averages at the edges and keeps gaps", () => {
    expect(median3([1, 3, null, 5])).toEqual([2, 2, null, 5]);
    expect(median3([])).toEqual([]);
    expect(median3([7])).toEqual([7]);
  });
});

describe("argmin / argmax", () => {
  it("finds the extremum and ignores nulls", () => {
    expect(argmin([5, null, 2, 3])).toBe(2);
    expect(argmax([5, null, 2, 9])).toBe(3);
    expect(argmin([null, undefined])).toBe(-1);
  });
  it("breaks ties by the tie-break series, then the earliest index", () => {
    expect(argmin([2, 1, 1, 3], [0, 5, 9, 0])).toBe(2);
    expect(argmin([2, 1, 1, 3])).toBe(1);
    // values within tol are tied
    expect(argExtremum([60, 61.5, 70], "min", [1, 10, 100], 2)).toBe(1);
  });
});

describe("localExtrema", () => {
  const times = Array.from({ length: 40 }, (_, i) => i * 0.25);
  // elbow angle: 170 at the hang, 60 at the tops, every 2.5 s
  const sig = times.map((t) => 115 - 55 * Math.cos((2 * Math.PI * (t - 1.25)) / 2.5));
  it("finds one minimum per rep", () => {
    const tops = localExtrema(times, sig, "min", 0.8).map((i) => times[i]);
    expect(tops).toEqual([1.25, 3.75, 6.25, 8.75]);
    const hangs = localExtrema(times, sig, "max", 0.8).map((i) => times[i]);
    expect(hangs).toEqual([2.5, 5, 7.5]); // endpoints excluded
  });
  it("enforces the separation and the prominence", () => {
    const t = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
    const v = [100, 60, 61, 59, 100, 99, 100];
    expect(localExtrema(t, v, "min", 0.8)).toEqual([3]); // 59 wins, 60 too close; 99 not prominent
    expect(localExtrema([], [], "min")).toEqual([]);
  });
});

describe("sharpness", () => {
  it("rgbaToGray converts pixels", () => {
    const g = rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255], 2, 1);
    expect(g[0]).toBeGreaterThan(250);
    expect(g[1]).toBe(0);
  });
  it("laplacianVariance is higher for an edge pattern than a flat image", () => {
    const w = 8;
    const h = 8;
    const flat = new Uint8Array(w * h).fill(128);
    const checker = new Uint8Array(w * h).map((_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0));
    expect(laplacianVariance(flat, w, h)).toBe(0);
    expect(laplacianVariance(checker, w, h)).toBeGreaterThan(1000);
    expect(laplacianVariance(flat, 2, 2)).toBe(0);
  });
});
