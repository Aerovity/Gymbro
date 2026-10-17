// Pure time-series and image-sharpness helpers (unit-tested; no DOM).

export type Series = ReadonlyArray<number | null | undefined>;

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Median of a 3-sample window (missing values ignored). Endpoints use the 2 available samples. */
export function median3(series: Series): (number | null)[] {
  return series.map((_, i) => {
    const w = [series[i - 1], series[i], series[i + 1]].filter(isNum).sort((a, b) => a - b);
    if (!isNum(series[i])) return null; // keep gaps as gaps
    if (w.length === 3) return w[1];
    if (w.length === 2) return (w[0] + w[1]) / 2;
    return w[0] ?? null;
  });
}

/**
 * Index of the min/max value. Values within `tol` of the extremum are tied; ties go to the
 * largest `tieBreak[i]` (e.g. sharpness), then to the earliest index. Returns -1 if no values.
 */
export function argExtremum(values: Series, mode: "min" | "max", tieBreak?: Series, tol = 0): number {
  let best: number | null = null;
  for (const v of values) if (isNum(v) && (best === null || (mode === "min" ? v < best : v > best))) best = v;
  if (best === null) return -1;
  let idx = -1;
  let idxTb = -Infinity;
  values.forEach((v, i) => {
    if (!isNum(v) || Math.abs(v - best!) > tol) return;
    const tb = tieBreak && isNum(tieBreak[i]) ? tieBreak[i]! : -Infinity;
    if (idx === -1 || tb > idxTb) {
      idx = i;
      idxTb = tb;
    }
  });
  return idx;
}
export const argmin = (values: Series, tieBreak?: Series, tol = 0) => argExtremum(values, "min", tieBreak, tol);
export const argmax = (values: Series, tieBreak?: Series, tol = 0) => argExtremum(values, "max", tieBreak, tol);

/**
 * Local extrema of a sampled signal, separated by at least `minSep` seconds.
 * A candidate must be an interior sample ≤ (min) / ≥ (max) its nearest valid neighbours and lie in the extreme
 * `prominenceFrac` of the signal's range. Greedy: best values first. Returned in time order.
 */
export function localExtrema(
  times: readonly number[],
  values: Series,
  mode: "min" | "max",
  minSep = 0.8,
  prominenceFrac = 0.5,
): number[] {
  const valid = values.map((v, i) => (isNum(v) ? i : -1)).filter((i) => i >= 0);
  if (valid.length === 0) return [];
  const vs = valid.map((i) => values[i] as number);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const range = hi - lo;
  const better = (a: number, b: number) => (mode === "min" ? a <= b : a >= b);
  const cands: number[] = [];
  valid.forEach((i, k) => {
    const v = values[i] as number;
    const prev = k > 0 ? (values[valid[k - 1]] as number) : null;
    const next = k < valid.length - 1 ? (values[valid[k + 1]] as number) : null;
    // Endpoints are excluded: the clip may start/end mid-movement.
    if (prev === null || next === null) return;
    if (!better(v, prev) || !better(v, next)) return;
    if (range > 0) {
      const frac = mode === "min" ? (v - lo) / range : (hi - v) / range;
      if (frac > prominenceFrac) return;
    }
    cands.push(i);
  });
  cands.sort((a, b) => (mode === "min" ? (values[a] as number) - (values[b] as number) : (values[b] as number) - (values[a] as number)));
  const chosen: number[] = [];
  for (const c of cands) if (chosen.every((o) => Math.abs(times[o] - times[c]) >= minSep)) chosen.push(c);
  return chosen.sort((a, b) => a - b);
}

/** RGBA (canvas ImageData) → 8-bit luma. */
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return out;
}

/** Variance of the 4-neighbour Laplacian over interior pixels: higher = sharper. */
export function laplacianVariance(gray: ArrayLike<number>, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += l;
      sumSq += l * l;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
