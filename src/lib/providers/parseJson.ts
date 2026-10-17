// Tolerant parsing of video-model output into ScanModelOutput (spec §7.2).
import { ScanModelOutputSchema, type ScanModelOutput } from "../schemas";
import { EXERCISES, type ExerciseId, type ScanEvent, type View } from "../types";

export class ScanParseError extends Error {
  readonly raw: string;
  constructor(message: string, raw = "", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScanParseError";
    this.raw = raw.slice(0, 2000);
  }
}

/** Remove <think>…</think> reasoning. A dangling "</think>" (opening tag omitted) drops everything before it. */
export function stripThink(text: string): string {
  let out = String(text ?? "").replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
  const close = out.toLowerCase().lastIndexOf("</think>");
  if (close >= 0) out = out.slice(close + "</think>".length);
  // Unterminated <think> with JSON after it: keep from the first JSON-looking char after the tag.
  const open = out.search(/<think\b[^>]*>/i);
  if (open >= 0) {
    const rest = out.slice(open).replace(/<think\b[^>]*>/i, "");
    const j = rest.search(/[{[]/);
    out = out.slice(0, open) + (j >= 0 ? rest.slice(j) : "");
  }
  return out.trim();
}

function stripFences(text: string): string {
  const m = text.match(/```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/);
  if (m && /[{[]/.test(m[1])) return m[1].trim();
  return text.replace(/```[a-zA-Z0-9_-]*/g, "").trim();
}

/** First balanced {…} or […] (string- and escape-aware). Returns the substring or null. */
export function findBalanced(text: string): string | null {
  for (let start = 0; start < text.length; start++) {
    const ch = text[start];
    if (ch !== "{" && ch !== "[") continue;
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
      else if (c === "}" || c === "]") {
        if (stack.pop() !== c) break; // mismatched; try the next start
        if (!stack.length) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Common model slips: trailing commas, smart quotes.
    const fixed = s.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"');
    return JSON.parse(fixed);
  }
}

/** Extract the first JSON value from model text (think blocks, code fences and prose tolerated). */
export function extractJson(text: string): unknown {
  const cleaned = stripFences(stripThink(text));
  const block = findBalanced(cleaned);
  if (!block) throw new ScanParseError("No JSON object found in model output", text);
  try {
    return tryParse(block);
  } catch (err) {
    throw new ScanParseError("Model output contained invalid JSON", text, { cause: err });
  }
}

/** Seconds from numbers or strings like "0:07", "7.2s", "00:00:07.5", "t=7.25s", "7 sec". */
export function parseTimestamp(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  s = s.replace(/^t\s*[=:]\s*/, "").replace(/^@/, "");
  const clock = s.match(/^(\d+(?::\d+){1,2}(?:\.\d+)?)\s*s?$/);
  if (clock) {
    const parts = clock[1].split(":").map(Number);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const ms = s.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (ms) return Number(ms[1]) / 1000;
  const sec = s.match(/^(\d*\.?\d+)\s*(?:s|sec|secs|second|seconds)?$/);
  if (sec) return Number(sec[1]);
  return null;
}

const EXERCISE_ALIASES: Array<[RegExp, ExerciseId]> = [
  [/push.?press/, "overhead_press"], // a push press is an overhead lift, not a push-up
  [/push.?ups?\b|press.?ups?\b/, "push_up"], // push-up, pushup, push up, press-up, diamond / close-grip push-up
  [/pull|chin/, "pull_up"], // pull-up, pullup, chin-up, chinup
  [/bench/, "bench_press"],
  [/dead|rdl/, "deadlift"],
  [/overhead|ohp|military|shoulder.?press/, "overhead_press"],
  [/curl|bicep/, "biceps_curl"],
  [/squat/, "squat"],
];

export function mapExercise(v: unknown): ExerciseId | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if ((EXERCISES as readonly string[]).includes(s)) return s as ExerciseId;
  return EXERCISE_ALIASES.find(([re]) => re.test(s))?.[1];
}

export function mapView(v: unknown): View | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (/side|lateral|profile|sagittal/.test(s)) return "side";
  if (/angle|oblique|diagonal|45|three.?quarter/.test(s)) return "angled";
  if (/front|rear|back|behind|frontal/.test(s)) return "front";
  return "unknown";
}

const SEVERITY_WORDS: Record<string, number> = { critical: 5, severe: 5, high: 4, major: 4, moderate: 3, medium: 3, mild: 2, low: 2, minor: 1 };
const CONF_WORDS: Record<string, number> = { high: 0.85, medium: 0.6, moderate: 0.6, low: 0.35 };

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.match(/-?\d*\.?\d+/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function coerceSeverity(v: unknown): number {
  if (typeof v === "string" && SEVERITY_WORDS[v.trim().toLowerCase()]) return SEVERITY_WORDS[v.trim().toLowerCase()];
  let n = num(v);
  if (n === null) return 3;
  if (typeof v === "string" && /\/\s*10/.test(v)) n = n / 2;
  return clamp(Math.round(n), 1, 5);
}

function coerceConfidence(v: unknown): number {
  if (typeof v === "string" && CONF_WORDS[v.trim().toLowerCase()] !== undefined) return CONF_WORDS[v.trim().toLowerCase()];
  let n = num(v);
  if (n === null) return 0.5;
  if ((typeof v === "string" && v.includes("%")) || n > 1) n = n / 100;
  return clamp(n, 0, 1);
}

function str(v: unknown, fallback: string, max: number): string {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return (s || fallback).slice(0, max);
}

function snap(t: number, frameTimes?: readonly number[]): number {
  if (!frameTimes?.length) return t;
  let best = frameTimes[0];
  for (const f of frameTimes) if (Math.abs(f - t) < Math.abs(best - t)) best = f;
  return best;
}

const firstDefined = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

function coerceEvent(raw: unknown, duration: number, frameTimes?: readonly number[]): ScanEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const peakRaw = parseTimestamp(firstDefined(o, ["t_peak", "peak", "t", "timestamp", "time", "at", "t_sec"]));
  let startRaw = parseTimestamp(firstDefined(o, ["t_start", "start", "from"]));
  let endRaw = parseTimestamp(firstDefined(o, ["t_end", "end", "to"]));
  let peak = peakRaw;
  if (peak === null) {
    if (startRaw !== null && endRaw !== null) peak = (startRaw + endRaw) / 2;
    else peak = startRaw ?? endRaw;
  }
  if (peak === null) return null;
  const fit = (t: number) => snap(clamp(t, 0, duration), frameTimes);
  peak = fit(peak);
  startRaw = startRaw === null ? Math.max(0, peak - 0.5) : startRaw;
  endRaw = endRaw === null ? Math.min(duration, peak + 0.5) : endRaw;
  const t_start = Math.min(fit(startRaw), peak);
  const t_end = Math.max(fit(endRaw), peak);

  const issueRaw = str(firstDefined(o, ["issue", "fault", "type", "name", "label"]), "technique_fault", 60);
  const issue = issueRaw.length >= 2 ? issueRaw : "technique_fault";
  const rep = num(firstDefined(o, ["rep_index", "rep", "repIndex", "rep_number"]));
  return {
    t_start,
    t_peak: peak,
    t_end,
    ...(rep !== null && rep >= 0 ? { rep_index: Math.round(rep) } : {}),
    issue,
    body_part: str(firstDefined(o, ["body_part", "bodyPart", "part", "joint"]), "body", 30),
    severity: coerceSeverity(o.severity),
    confidence: coerceConfidence(o.confidence),
    description: str(firstDefined(o, ["description", "detail", "details", "explanation", "reason"]), "", 300),
  };
}

export interface ParseScanOptions {
  duration: number;
  /** Sampled frame times; timestamps snap to the nearest one. */
  frameTimes?: readonly number[];
}

/** Parse + coerce + clamp + snap model text into a valid ScanModelOutput. Throws ScanParseError. */
export function parseScanOutput(text: string, { duration, frameTimes }: ParseScanOptions): ScanModelOutput {
  const raw = extractJson(text);
  const obj: Record<string, unknown> | null = Array.isArray(raw)
    ? { events: raw }
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : null;
  if (!obj) throw new ScanParseError("Model output JSON is not an object", text);
  const evRaw = firstDefined(obj, ["events", "faults", "moments", "issues", "errors"]);
  if (evRaw !== undefined && !Array.isArray(evRaw)) throw new ScanParseError("`events` is not an array", text);
  if (evRaw === undefined && !("exercise" in obj) && !("overall" in obj)) {
    throw new ScanParseError("Model output has no events", text);
  }
  const d = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
  const events = ((evRaw as unknown[] | undefined) ?? [])
    .map((e) => coerceEvent(e, d, frameTimes))
    .filter((e): e is ScanEvent => e !== null)
    .slice(0, 8);
  const repCount = num(firstDefined(obj, ["rep_count", "repCount", "reps"]));
  const exercise = mapExercise(obj.exercise);
  const view = mapView(obj.view);
  const overall = typeof obj.overall === "string" ? obj.overall.slice(0, 400) : undefined;
  const candidate = {
    ...(exercise ? { exercise } : {}),
    ...(view ? { view } : {}),
    ...(repCount !== null && repCount >= 0 ? { rep_count: Math.round(repCount) } : {}),
    events,
    ...(overall ? { overall } : {}),
  };
  const res = ScanModelOutputSchema.safeParse(candidate);
  if (!res.success) throw new ScanParseError(`Model output failed validation: ${res.error.message}`, text);
  return res.data;
}
