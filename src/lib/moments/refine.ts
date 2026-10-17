// Local pose refinement of a scan timestamp (spec §7.4) and the pose-only fallback scan.
// Browser only: sequential seeks on one video element + MediaPipe VIDEO landmarker.
import type { AngleReport, ExerciseId, PoseResult, ScanEvent, TraceEntry } from "../types";
import { PHASE, RULES } from "../exercises/rules";
import { computeAngleReport, computeMetric } from "../angles/compute";
import { detectPose, detectVideoFrame } from "../pose/detect";
import { LM } from "../pose/landmarks";
import { seekTo } from "../video/seek";
import { ctx2d, drawVideoFrame, grabFrame, makeCanvas, planSampleTimes, scaledSize } from "../video/extractFrames";
import { argExtremum, laplacianVariance, localExtrema, median3, rgbaToGray } from "./series";

export const REFINE_WINDOW_S = 0.6;
export const REFINE_FPS = 10;
export const REFINE_LONG_EDGE = 640;
export const SCAN_FPS = 4;
export const SCAN_MAX_FRAMES = 60;
export const REP_MIN_SEP_S = 0.8;
const SHARP_EDGE = 160;
/** Signal values within this many degrees of the extremum are tied → sharpest frame wins. */
const TIE_TOL = 2;

/** "0:07.2" */
export function fmtClock(t: number): string {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const abortErr = () => new DOMException("Aborted", "AbortError");

/** Times at `fps` spanning [t-w, t+w] clamped to the clip, always including t itself. */
export function refineTimes(t: number, duration: number, w = REFINE_WINDOW_S, fps = REFINE_FPS): number[] {
  const lo = Math.max(0, t - w);
  const hi = Math.min(Math.max(0, duration - 0.05), t + w);
  const out: number[] = [];
  const step = 1 / fps;
  for (let k = Math.ceil((lo - t) / step - 1e-9); t + k * step <= hi + 1e-9; k++) out.push(Math.round((t + k * step) * 1000) / 1000);
  return out.length ? out : [Math.min(Math.max(0, t), hi)];
}

export interface PoseSample {
  t: number;
  pose: PoseResult | null;
  signal: number | null; // PHASE[exercise].signal (visibility-gated joint angle)
  body: number | null; // robust body-height fallback signal (‰ of frame height)
  sharpness: number;
}

/**
 * Robust phase fallback: vertical position (‰ of frame height, 0 = top) of landmarks that are
 * almost never occluded. Used when the PHASE joint-angle signal is mostly missing, e.g. a pull-up
 * filmed from behind, where the forearms disappear behind the head at the top of every rep.
 */
export const BODY_SIGNAL: Partial<Record<ExerciseId, { extremum: "min" | "max"; idx: number[] }>> = {
  pull_up: { extremum: "min", idx: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP] }, // body highest
  squat: { extremum: "max", idx: [LM.L_HIP, LM.R_HIP] }, // hips lowest
  deadlift: { extremum: "min", idx: [LM.L_SHOULDER, LM.R_SHOULDER] }, // shoulders highest
};

export function bodySignal(pose: PoseResult, exercise: ExerciseId): number | null {
  const def = BODY_SIGNAL[exercise];
  if (!def) return null;
  let y = 0;
  for (const i of def.idx) {
    const l = pose.landmarks[i];
    if (!l || !Number.isFinite(l.y)) return null;
    y += l.y;
  }
  return (y / def.idx.length) * 1000;
}

/** Minimum share of posed frames that must carry the joint-angle signal before we trust it. */
export const MIN_SIGNAL_COVERAGE = 0.8;

export interface ChosenSignal {
  kind: "joint" | "body";
  values: (number | null)[]; // median3-smoothed
  extremum: "min" | "max";
  tol: number;
}

/** Pure: pick the joint-angle PHASE signal when well covered, else the body-height fallback. */
export function chooseSignal(samples: ReadonlyArray<Pick<PoseSample, "pose" | "signal" | "body">>, exercise: ExerciseId): ChosenSignal {
  const posed = samples.filter((s) => s.pose).length;
  const withSignal = samples.filter((s) => s.signal !== null).length;
  const fb = BODY_SIGNAL[exercise];
  const useBody = !!fb && posed > 0 && withSignal / posed < MIN_SIGNAL_COVERAGE;
  if (useBody) return { kind: "body", values: median3(samples.map((s) => s.body)), extremum: fb!.extremum, tol: 3 };
  return { kind: "joint", values: median3(samples.map((s) => s.signal)), extremum: PHASE[exercise].extremum, tol: TIE_TOL };
}

/** Seek, draw at 640 px, measure sharpness and run the VIDEO landmarker for each time. */
async function samplePoses(
  video: HTMLVideoElement,
  times: number[],
  exercise: ExerciseId,
  signal?: AbortSignal,
  onSample?: (s: PoseSample, i: number, n: number) => void,
): Promise<PoseSample[]> {
  const canvas = makeCanvas(2, 2);
  const { width: sw, height: sh } = scaledSize(video.videoWidth, video.videoHeight, SHARP_EDGE);
  const small = makeCanvas(sw, sh);
  const sctx = ctx2d(small);
  const out: PoseSample[] = [];
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) throw abortErr();
    const t = times[i];
    await seekTo(video, t);
    const { width, height } = drawVideoFrame(video, canvas, REFINE_LONG_EDGE);
    sctx.drawImage(canvas, 0, 0, sw, sh);
    const sharpness = laplacianVariance(rgbaToGray(sctx.getImageData(0, 0, sw, sh).data, sw, sh), sw, sh);
    let pose: PoseResult | null = null;
    try {
      pose = await detectVideoFrame(canvas, t * 1000, width, height);
    } catch (e) {
      if (i === 0) throw e; // model failed to load at all
    }
    const s: PoseSample = {
      t,
      pose,
      signal: pose ? PHASE[exercise].signal(pose) : null,
      body: pose ? bodySignal(pose, exercise) : null,
      sharpness,
    };
    out.push(s);
    onSample?.(s, i, times.length);
  }
  return out;
}

/**
 * Refine a scan event's t_peak to the exact phase extremum (e.g. the top of a pull-up = min
 * mean elbow angle). Never throws for "no pose": it keeps the original time with ok=false.
 */
export async function refineMoment(
  video: HTMLVideoElement,
  event: Pick<ScanEvent, "t_peak">,
  exercise: ExerciseId,
  signal?: AbortSignal,
): Promise<{ t: number; trace: TraceEntry; samples: PoseSample[] }> {
  const t0 = performance.now();
  const from = event.t_peak;
  try {
    const samples = await samplePoses(video, refineTimes(from, video.duration), exercise, signal);
    const sig = chooseSignal(samples, exercise);
    const idx = argExtremum(sig.values, sig.extremum, samples.map((s) => s.sharpness), sig.tol);
    const ms = Math.round(performance.now() - t0);
    if (idx < 0) {
      return {
        t: from,
        samples,
        trace: { step: "refine", provider: "mediapipe", ok: false, ms, detail: `no clear pose near ${fmtClock(from)} — kept it` },
      };
    }
    const t = samples[idx].t;
    return {
      t,
      samples,
      trace: {
        step: "refine",
        provider: "mediapipe",
        model: "pose_landmarker_lite",
        ok: true,
        ms,
        detail: `refined ${fmtClock(from)} → ${fmtClock(t)}${sig.kind === "body" ? " (body height)" : ""}`,
      },
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return {
      t: from,
      samples: [],
      trace: {
        step: "refine",
        provider: "mediapipe",
        ok: false,
        ms: Math.round(performance.now() - t0),
        error: e instanceof Error ? e.message : String(e),
        detail: `refinement failed — kept ${fmtClock(from)}`,
      },
    };
  }
}

// ───────────── pose-only scan ─────────────

const BODY_PART: Array<[RegExp, string]> = [
  [/chin|head|neck/, "head"],
  [/elbow|arm|wrist/, "arms"],
  [/knee|leg|tibia|ankle/, "legs"],
  [/shoulder/, "shoulders"],
  [/hip|depth/, "hips"],
  [/back|torso|trunk|sway|lean|spine/, "torso"],
];
export function bodyPartFor(angleKey: string): string {
  for (const [re, part] of BODY_PART) if (re.test(angleKey)) return part;
  return "body";
}

export interface RepTop {
  t: number;
  pose?: PoseResult;
  signal: number | null;
  report: AngleReport;
  metrics: Record<string, number | null>;
}

/** Pure: turn the per-rep reports into the worst 1–3 ScanEvents. */
export function eventsFromReps(reps: RepTop[], times: readonly number[], max = 3): ScanEvent[] {
  if (reps.length === 0) return [];
  const ranked = reps
    .map((r, k) => ({ r, k, v: r.report.violations[0] }))
    .sort((a, b) => (b.v?.severity ?? 0) - (a.v?.severity ?? 0) || (b.v?.deviation ?? 0) - (a.v?.deviation ?? 0));
  const withFaults = ranked.filter((x) => x.v);
  const chosen = (withFaults.length ? withFaults : ranked.slice(0, 1)).slice(0, max);
  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? 0;
  return chosen.map(({ r, k, v }) => {
    const prev = reps[k - 1]?.t;
    const next = reps[k + 1]?.t;
    const t_start = Math.max(tMin, prev !== undefined ? (prev + r.t) / 2 : r.t - 1);
    const t_end = Math.min(tMax, next !== undefined ? (next + r.t) / 2 : r.t + 1);
    const fmt = (x: number, unit: string) => (unit === "ratio" ? x.toFixed(2) : `${Math.round(x)}°`);
    const unit = v ? (r.report.angles.find((a) => a.key === v.angleKey)?.unit ?? "°") : "°";
    const tgt = v ? (v.target.max !== undefined ? `≤${fmt(v.target.max, unit)}` : `≥${fmt(v.target.min ?? v.target.ideal, unit)}`) : "";
    return {
      t_start: Math.round(t_start * 100) / 100,
      t_peak: Math.round(r.t * 100) / 100,
      t_end: Math.round(Math.max(t_start, t_end) * 100) / 100,
      rep_index: k + 1,
      issue: (v ? v.label : "Rep top position").slice(0, 60),
      body_part: v ? bodyPartFor(v.angleKey) : "body",
      severity: v ? Math.min(5, Math.max(1, v.severity)) : 1,
      confidence: 0.6,
      description: (v
        ? `Rep ${k + 1}: ${v.label} ${fmt(v.actual, unit)} (target ${tgt}). ${v.cue}`
        : `Rep ${k + 1}: no rule violations measured from pose.`
      ).slice(0, 300),
    };
  });
}

export interface PoseOnlyScanDetail {
  events: ScanEvent[];
  signalKind: "joint" | "body";
  samples: Array<{
    t: number;
    signal: number | null;
    body: number | null;
    smoothed: number | null;
    sharpness: number;
    visible: boolean;
    /** Visibility-gated metrics from the lite VIDEO pose (null = unmeasurable). */
    metrics: Record<string, number | null>;
  }>;
  reps: Array<{
    t: number;
    signal: number | null;
    metrics: Record<string, number | null>; // visibility-gated (what the app reports)
    rawMetrics: Record<string, number | null>; // computeMetric, ignoring visibility (diagnostic)
    visibility: Record<string, number>; // key joints
    violations: string[];
    score: number;
  }>;
  effectiveFps: number;
  ms: number;
}

/** Full-clip scan at ~4 fps (≤60 frames) with diagnostics (used by the dev page). */
export async function poseOnlyScanDetailed(
  video: HTMLVideoElement,
  exercise: ExerciseId,
  duration: number,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<PoseOnlyScanDetail> {
  const t0 = performance.now();
  const { times, effectiveFps } = planSampleTimes(duration, SCAN_FPS, SCAN_MAX_FRAMES);
  const samples = await samplePoses(video, times, exercise, signal, (_s, i, n) => onProgress?.(i + 1, n));
  const sig = chooseSignal(samples, exercise);
  const smooth = sig.values;
  const loc = PHASE[exercise];
  const idx = localExtrema(times, smooth, sig.extremum, REP_MIN_SEP_S);
  // Evaluate each rep's extremum with the heavy IMAGE model on a full-res grab (much better
  // landmarks than the lite tracker); fall back to the lite pose.
  const reps: RepTop[] = [];
  for (const i of idx) {
    if (signal?.aborted) throw abortErr();
    let pose = samples[i].pose;
    try {
      const g = await grabFrame(video, samples[i].t, { longEdge: 1280, quality: 0.8 });
      pose = (await detectPose(g.canvas, g.width, g.height)) ?? pose;
    } catch {
      /* keep the lite pose */
    }
    if (!pose) continue;
    const report = computeAngleReport(pose, exercise, { phase: loc.phase });
    const metrics = Object.fromEntries(report.angles.map((a) => [a.key, a.value]));
    reps.push({ t: samples[i].t, pose, signal: smooth[i], report, metrics });
  }
  const events = eventsFromReps(reps, times);
  return {
    events,
    signalKind: sig.kind,
    samples: samples.map((s, i) => ({
      t: s.t,
      signal: s.signal === null ? null : Math.round(s.signal * 10) / 10,
      body: s.body === null ? null : Math.round(s.body * 10) / 10,
      smoothed: smooth[i] === null ? null : Math.round(smooth[i]! * 10) / 10,
      sharpness: Math.round(s.sharpness),
      visible: !!s.pose,
      metrics: s.pose
        ? Object.fromEntries(
            computeAngleReport(s.pose, exercise, { phase: loc.phase }).angles.map((a) => [
              a.key,
              a.value === null ? null : Math.round(a.value * 1000) / 1000,
            ]),
          )
        : {},
    })),
    reps: reps.map((r) => ({
      t: r.t,
      signal: r.signal === null ? null : Math.round(r.signal * 10) / 10,
      metrics: Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [k, v === null ? null : Math.round(v * 1000) / 1000])),
      rawMetrics: Object.fromEntries(
        Object.keys(r.metrics).map((k) => {
          const v = r.pose ? computeMetric(r.pose, exercise, k) : null;
          return [k, v === null ? null : Math.round(v * 1000) / 1000];
        }),
      ),
      visibility: r.pose
        ? Object.fromEntries(
            (["NOSE", "L_SHOULDER", "R_SHOULDER", "L_ELBOW", "R_ELBOW", "L_WRIST", "R_WRIST", "L_HIP", "R_HIP", "L_KNEE", "R_KNEE", "L_ANKLE", "R_ANKLE"] as const).map(
              (n) => [n, Math.round((r.pose!.landmarks[LM[n]]?.visibility ?? 0) * 100) / 100],
            ),
          )
        : {},
      violations: r.report.violations.map((v) => `${v.ruleId} (sev ${v.severity})`),
      score: r.report.score,
    })),
    effectiveFps,
    ms: Math.round(performance.now() - t0),
  };
}

/** Local fallback scan: ScanEvents for the worst 1–3 reps, found from pose alone. */
export async function poseOnlyScan(
  video: HTMLVideoElement,
  exercise: ExerciseId,
  duration: number,
  signal?: AbortSignal,
): Promise<ScanEvent[]> {
  return (await poseOnlyScanDetailed(video, exercise, duration, signal)).events;
}

/** Rule ids that apply to an exercise (re-exported for the dev page). */
export const rulesOf = (exercise: ExerciseId) => RULES[exercise].map((r) => r.id);

/** Rep capture window for the 3D viewer: from REP_BEFORE_S before to REP_AFTER_S after the moment. */
export const REP_BEFORE_S = 1.1;
export const REP_AFTER_S = 0.9;
export const REP_FPS = 12;

/** 3D world-landmark sequence around the chosen moment (drives the animated mannequins). */
export async function captureRep(
  video: HTMLVideoElement,
  t: number,
  exercise: ExerciseId,
  signal?: AbortSignal,
): Promise<{ t: number; world: PoseResult["worldLandmarks"] }[]> {
  const end = Math.max(0, video.duration - 0.05);
  const from = Math.max(0, t - REP_BEFORE_S);
  const to = Math.min(end, t + REP_AFTER_S);
  const times: number[] = [];
  for (let x = from; x <= to + 1e-6; x += 1 / REP_FPS) times.push(Math.round(x * 1000) / 1000);
  const samples = await samplePoses(video, times, exercise, signal);
  return samples.filter((s) => s.pose?.worldLandmarks?.length === 33).map((s) => ({ t: s.t, world: s.pose!.worldLandmarks }));
}
