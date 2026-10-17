import { describe, expect, it } from "vitest";
import type { SampledFrame } from "@/lib/types";
import {
  cropIntersection,
  dropEveryOther,
  evenIndices,
  fitPayloadWith,
  payloadBytes,
  planSampleTimes,
  scaledSize,
} from "@/lib/video/extractFrames";
import { formatTimestamp, timestampBarLayout } from "@/lib/video/burnTimestamp";

const frame = (t: number, len: number): SampledFrame => ({
  t,
  dataUrl: "data:image/jpeg;base64," + "A".repeat(len),
  width: 252,
  height: 448,
});

describe("burnTimestamp formatting", () => {
  it("formats with 2 decimals", () => {
    expect(formatTimestamp(1.25)).toBe("t=1.25s");
    expect(formatTimestamp(7)).toBe("t=7.00s");
    expect(formatTimestamp(12.5)).toBe("t=12.50s");
    expect(formatTimestamp(-1)).toBe("t=0.00s");
    expect(formatTimestamp(NaN)).toBe("t=0.00s");
  });
  it("bar is 12% of the height at the bottom", () => {
    const l = timestampBarLayout(252, 448);
    expect(l.barH).toBe(54);
    expect(l.barY).toBe(448 - 54);
    expect(l.textY).toBeCloseTo(448 - 27);
  });
});

describe("sampling plan", () => {
  it("keeps the requested fps when under maxFrames", () => {
    const { times, effectiveFps } = planSampleTimes(5, 4, 40);
    expect(effectiveFps).toBe(4);
    expect(times).toHaveLength(20);
    expect(times[0]).toBeCloseTo(0.125);
  });
  it("lowers the fps for long clips", () => {
    const { times, effectiveFps } = planSampleTimes(15, 4, 40);
    expect(effectiveFps).toBeCloseTo(40 / 15, 2);
    expect(times.length).toBeLessThanOrEqual(40);
    expect(Math.max(...times)).toBeLessThanOrEqual(15);
  });
  it("respects a trim window", () => {
    const { times } = planSampleTimes(15, 4, 40, 5, 7);
    expect(times).toHaveLength(8);
    expect(times.every((t) => t >= 5 && t <= 7)).toBe(true);
  });
  it("scaledSize keeps the long edge and never upscales", () => {
    expect(scaledSize(720, 1280, 448)).toEqual({ width: 252, height: 448 });
    expect(scaledSize(1920, 1080, 448).width).toBe(448);
    expect(scaledSize(200, 100, 448)).toEqual({ width: 200, height: 100 });
  });
  it("evenIndices", () => {
    expect(evenIndices(40, 16)).toHaveLength(16);
    expect(evenIndices(40, 16)[0]).toBe(0);
    expect(evenIndices(40, 16)[15]).toBe(39);
    expect(evenIndices(5, 16)).toEqual([0, 1, 2, 3, 4]);
    expect(evenIndices(0, 16)).toEqual([]);
  });
});

describe("fitPayload budgeting", () => {
  const halve = async (f: SampledFrame) => ({ ...f, dataUrl: f.dataUrl.slice(0, Math.ceil(f.dataUrl.length / 2)) });
  it("returns frames unchanged within budget", async () => {
    const frames = [frame(0, 100), frame(1, 100)];
    const r = await fitPayloadWith(frames, 10_000, halve);
    expect(r.reencoded).toBe(false);
    expect(r.frames).toEqual(frames);
    expect(r.fpsScale).toBe(1);
  });
  it("re-encodes first at q 0.55", async () => {
    const qs: number[] = [];
    const frames = Array.from({ length: 10 }, (_, i) => frame(i, 1000));
    const r = await fitPayloadWith(frames, 6000, async (f, q) => {
      qs.push(q);
      return halve(f);
    });
    expect(qs).toHaveLength(10);
    expect(qs.every((q) => q === 0.55)).toBe(true);
    expect(r.reencoded).toBe(true);
    expect(r.frames).toHaveLength(10);
    expect(r.bytes).toBeLessThanOrEqual(6000);
  });
  it("then drops every other frame until it fits", async () => {
    const frames = Array.from({ length: 40 }, (_, i) => frame(i, 1000));
    const r = await fitPayloadWith(frames, 6000, halve);
    expect(r.bytes).toBeLessThanOrEqual(6000);
    expect(r.frames.map((f) => f.t)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
    expect(r.fpsScale).toBe(0.25);
    expect(r.dropped).toBe(30);
    expect(payloadBytes(r.frames)).toBe(r.bytes);
  });
  it("never drops the last frame", async () => {
    const r = await fitPayloadWith([frame(0, 1000), frame(1, 1000)], 10, halve);
    expect(r.frames).toHaveLength(1);
    expect(dropEveryOther([1])).toEqual([1]);
  });
});

describe("cropIntersection", () => {
  it("clamps to the source", () => {
    expect(cropIntersection({ x: -10, y: 20, w: 100, h: 2000 }, 720, 1280)).toEqual({
      x0: 0,
      y0: 20,
      x1: 90,
      y1: 1280,
      empty: false,
    });
    expect(cropIntersection({ x: 800, y: 0, w: 10, h: 10 }, 720, 1280).empty).toBe(true);
  });
});
