// Shared presentational helpers for Gym Bro UI (colours for SVG, formatting, verdict helpers).
import type { AngleMeasurement, TargetRange, Verdict } from "@/lib/types";

/** Raw hex palette (mirrors globals.css tokens) for SVG attributes. */
export const C = {
  bg: "#07090c",
  surface: "#0e1218",
  surface2: "#151b23",
  surface3: "#1c2430",
  line: "#232b36",
  text: "#e8eef5",
  dim: "#8a97a8",
  volt: "#c6ff3d",
  signal: "#ff3b5c",
  amber: "#ffb020",
  cyan: "#2ee6ff",
  nvidia: "#76b900",
} as const;

export const verdictColor = (v: Verdict | undefined): string =>
  v === "good" ? C.volt : v === "borderline" ? C.amber : v === "bad" ? C.signal : C.dim;

export const verdictText: Record<Verdict, string> = {
  good: "In range",
  borderline: "Borderline",
  bad: "Out of range",
  unmeasurable: "Not measurable",
};

/** Text-colour utility class per verdict. */
export const verdictClass = (v: Verdict | undefined): string =>
  v === "good" ? "text-volt" : v === "borderline" ? "text-amber" : v === "bad" ? "text-signal" : "text-dim";

export const severityColor = (s: number): string => (s >= 4 ? C.signal : s >= 3 ? C.amber : C.cyan);

/** 7.4 → "0:07", precise → "0:07.4" */
export function fmtTime(t: number | undefined | null, precise = false): string {
  if (t == null || !Number.isFinite(t)) return "0:00";
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  if (precise) {
    const whole = Math.floor(sec);
    const tenth = Math.floor((sec - whole) * 10 + 1e-6);
    return `${m}:${String(whole).padStart(2, "0")}.${tenth}`;
  }
  return `${m}:${String(Math.floor(sec)).padStart(2, "0")}`;
}

export const fmtMs = (ms: number | undefined) =>
  ms == null ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

export function fmtValue(v: number | null | undefined, unit: AngleMeasurement["unit"]): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return unit === "ratio" ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) : `${Math.round(v)}°`;
}

/** "≤75°", "≥150°", "60–90°" */
export function fmtTarget(t: TargetRange | undefined, unit: AngleMeasurement["unit"]): string {
  if (!t) return "—";
  const f = (n: number) => (unit === "ratio" ? n.toFixed(2) : `${Math.round(n)}°`);
  if (t.min != null && t.max != null) return unit === "ratio" ? `${f(t.min)}–${f(t.max)}` : `${Math.round(t.min)}–${f(t.max)}`;
  if (t.max != null) return `≤${f(t.max)}`;
  if (t.min != null) return `≥${f(t.min)}`;
  return f(t.ideal);
}

/** Signed distance to the nearest bound (0 when inside). */
export function toGo(value: number | null, t: TargetRange | undefined): number | null {
  if (value == null || !t) return null;
  if (t.max != null && value > t.max) return t.max - value;
  if (t.min != null && value < t.min) return t.min - value;
  return 0;
}

export function fmtToGo(d: number | null, unit: AngleMeasurement["unit"]): string {
  if (d == null) return "—";
  if (d === 0) return "in range";
  const sign = d > 0 ? "+" : "−";
  return unit === "ratio" ? `${sign}${Math.abs(d).toFixed(2)} to go` : `${sign}${Math.round(Math.abs(d))}° to go`;
}

/** Plain-language gap to the target: "2° over", "3° short", "In range". */
export function fmtGap(d: number | null, unit: AngleMeasurement["unit"]): string {
  if (d == null) return "—";
  if (d === 0) return "In range";
  const mag = unit === "ratio" ? Math.abs(d).toFixed(2) : `${Math.max(1, Math.round(Math.abs(d)))}°`;
  return d < 0 ? `${mag} over` : `${mag} short`;
}

export const gradeColor = (g: string | undefined) =>
  g === "A" ? C.volt : g === "B" ? C.cyan : g === "C" ? C.amber : g === "D" ? C.signal : C.dim;

export const gradeFor = (score: number): "A" | "B" | "C" | "D" =>
  score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";

/** "uneven_pull" → "Uneven pull" */
export const humanize = (s: string | undefined) => {
  const t = (s ?? "").replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};
