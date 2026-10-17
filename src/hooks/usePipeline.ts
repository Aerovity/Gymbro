"use client";
// Pipeline orchestrator: drives the Zustand store through
// upload → scan (video model ∥ exercise detection) → pick + refine → pose/angles → coach.
// The AI photo of the fix (GPT Image edit → re-measure) is optional and on demand: generateAiPhoto().
// Every step writes a TraceEntry; every failure has a fallback so the UI is never empty.
import { INITIAL_STEPS, initialPipelineData, usePipelineStore, type DetectedExercise, type PipelineData, type StepId, type StepState } from "@/lib/store/pipeline";
import type { AngleReport, AppError, ChosenMoment, DemoId, ExerciseChoice, ExerciseId, PoseResult, ProviderId, ScanEvent, ScanResult, TraceEntry } from "@/lib/types";
import type { CoachReport } from "@/lib/schemas";
import type { RepFrame } from "@/lib/pose3d/skeleton3d";
import { SCAN_PAYLOAD_BUDGET } from "@/lib/schemas";
import { demoAsset, EXERCISE_INFO, EXERCISE_ORDER, isSupportedExercise } from "@/lib/exercises/catalog";
import { ApiClientError, postCorrect, postScan, streamCoach } from "@/lib/api/client";
import { pickMoment } from "@/lib/moments/pick";
import { computeAngleReport } from "@/lib/angles/compute";
import { detectView } from "@/lib/angles/view";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { verifyAfter } from "@/lib/exercises/verify";
import { PRIMARY_KEY } from "@/lib/exercises/rules";
import { computeCrop, transformPose } from "@/lib/video/crop";
import { compactKeypoints } from "@/lib/pose/compact";
import { disposeVideo, isAppErrorException, probeVideo, validateFile } from "@/lib/video/probe";
import { fitPayload, grabFrame, makeContactSheet, renderCrop, sampleFrames } from "@/lib/video/extractFrames";
import { preloadPose } from "@/lib/pose/landmarker";
import { detectPose, detectPoseFromUrl } from "@/lib/pose/detect";
import { captureRep, detectExercise, poseOnlyScan, refineMoment } from "@/lib/moments/refine";

export interface StartInput {
  file?: File;
  demoId?: DemoId;
  exercise: ExerciseChoice;
  /** Run a demo clip through the LIVE pipeline (API routes) instead of cached fixtures. */
  live?: boolean;
}

/** Live-run context kept so the user can re-analyse another moment or as another exercise. */
interface LiveCtx {
  video: HTMLVideoElement;
  duration: number;
  scan: ScanResult;
  exercise: ExerciseId;
  /** Candidate moments (the scan's events, or the on-device ones when the scan flagged nothing). */
  events: ScanEvent[];
  /** Exercise those events describe; when it differs from `exercise` they're used for timing only. */
  eventsExercise?: ExerciseId;
  /** Events came from the on-device pose scan (already on the measured frame). */
  onDevice: boolean;
  /** The event currently analysed (re-used by reanalyseAs). */
  event: ScanEvent;
}

let controller: AbortController | null = null;
let photoController: AbortController | null = null;
let pending: StartInput | null = null;
/** Input whose store state was already prepared by setPendingStart (so startPipeline won't reset it). */
let prepared: StartInput | null = null;
let lastInput: StartInput | null = null;
let liveCtx: LiveCtx | null = null;
/** The hidden probe <video> of the current run (removed when the next run starts). */
let activeVideo: HTMLVideoElement | null = null;
let runId = 0;

export const getLastInput = () => lastInput;

const store = () => usePipelineStore.getState();
const now = () => performance.now();
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
};
/** 7.4 → "0:07" for step labels. */
const clock = (t: number) => {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  return `${m}:${String(Math.floor(v - m * 60)).padStart(2, "0")}`;
};

/** Scan-step badge. Never claims Cosmos unless Cosmos actually answered. */
const SCANNING_BADGE = "NVIDIA video AI";
const PROVIDER_LABEL: Record<ProviderId, string> = {
  cosmos: "NVIDIA Cosmos",
  nemotron: "NVIDIA Nemotron",
  "gpt-fallback": "GPT vision",
  "pose-only": "On-device pose",
  demo: "Cached sample",
};
/** Nominal confidence of the video model's exercise call (it doesn't report one). */
const VIDEO_MODEL_CONFIDENCE = 0.75;
/** The pose classifier overrules a disagreeing video model from this confidence up. */
const POSE_WINS_AT = 0.6;

const label = (ex: ExerciseId) => EXERCISE_INFO[ex]?.label ?? ex.replace(/_/g, " ");
const initialLabel = (id: StepId) => INITIAL_STEPS.find((s) => s.id === id)?.label ?? id;

function step(id: StepId, patch: Partial<StepState>) {
  store().setStep(id, patch);
}
function trace(e: TraceEntry) {
  store().addTrace(e);
}
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Wraps a step: marks it active, times it, and bails out if the run was aborted meanwhile. */
async function timed<T>(id: StepId, signal: AbortSignal, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  step(id, { status: "active" });
  const t0 = now();
  const value = await fn();
  signal.throwIfAborted();
  return { value, ms: Math.round(now() - t0) };
}

export function abortPipeline() {
  controller?.abort();
  controller = null;
  photoController?.abort();
  photoController = null;
}

function disposeActiveVideo() {
  if (activeVideo) disposeVideo(activeVideo);
  activeVideo = null;
}

/** Everything derived from one analysed moment (cleared before re-analysing). */
const CLEARED_ANALYSIS: Partial<PipelineData> = {
  error: undefined,
  moment: undefined,
  crop: undefined,
  beforeImage: undefined,
  beforePose: undefined,
  angles: undefined,
  score: undefined,
  coach: undefined,
  coachText: "",
  coachFallback: false,
  afterImage: undefined,
  afterPose: undefined,
  repFrames: undefined,
  afterFailed: false,
  aiPhoto: "idle",
  aiPhotoError: undefined,
  verify: undefined,
};

/**
 * store.reset() merges the initial data in, so optional fields of the last run (moment, beforeImage,
 * scan, …) would survive it and flash on the next run. Clear every one of them explicitly.
 */
function resetStore() {
  store().reset();
  const fresh = initialPipelineData();
  const stale = Object.fromEntries(
    Object.entries(store())
      .filter(([k, v]) => !(k in fresh) && typeof v !== "function" && v !== undefined)
      .map(([k]) => [k, undefined]),
  ) as Partial<PipelineData>;
  store().set(stale);
}

/**
 * Synchronously abort any run, reset the store and show the new input (the user's own clip
 * as a blob URL, or the demo clip) so the very first render of /analyze is this run.
 */
function prepareRun(input: StartInput) {
  abortPipeline();
  disposeActiveVideo();
  liveCtx = null;
  prepared = null;
  resetStore();
  const demo = !!input.demoId && !input.live;
  const detected: DetectedExercise | undefined =
    input.exercise === "auto"
      ? undefined
      : input.demoId
        ? { exercise: input.exercise, confidence: 1, reason: "sample clip", source: "demo" }
        : { exercise: input.exercise, confidence: 1, reason: "you picked it", source: "user" };
  store().set({
    stage: "probing",
    exercise: input.exercise,
    demoId: input.demoId,
    demo,
    file: input.file,
    videoUrl: input.file ? URL.createObjectURL(input.file) : input.demoId ? `/demo/${input.demoId}/video.mp4` : undefined,
    startedAt: Date.now(),
    detected,
    resolvedExercise: detected?.exercise,
  });
}

/** Landing page → analyze page handoff (File objects can't travel through the URL). Resets the store now. */
export function setPendingStart(input: StartInput) {
  prepareRun(input);
  pending = input;
  prepared = input;
}
export function takePendingStart(): StartInput | null {
  const p = pending;
  pending = null;
  return p;
}

function fail(e: unknown) {
  console.error("[pipeline]", e);
  const s = store();
  const active = s.steps.find((st) => st.status === "active");
  if (active) step(active.id, { status: "failed" });
  const code = isAppErrorException(e) ? e.appError.code : ((e as { code?: AppError["code"] })?.code ?? "unknown");
  const message = isAppErrorException(e) ? e.appError.message : e instanceof Error ? e.message : String(e);
  s.set({ stage: "error", error: { code, message, stage: s.stage } });
}

export async function startPipeline(input: StartInput) {
  if (prepared !== input) prepareRun(input);
  prepared = null;
  abortPipeline();
  const myRun = ++runId;
  lastInput = input;
  controller = new AbortController();
  const signal = controller.signal;
  try {
    if (input.demoId && !input.live) await runDemo(input.demoId, signal);
    else await runLive(input, signal);
  } catch (e) {
    if (isAbort(e) || signal.aborted || myRun !== runId) return;
    fail(e);
  }
}

// ───────────────────────────── LIVE ─────────────────────────────

/** Combine the video model's and the pose classifier's exercise calls. Never silently defaults. */
function decideExercise(model: ExerciseId | undefined, pose: { exercise: ExerciseId; confidence: number; reason: string } | null): DetectedExercise {
  if (model && pose) {
    if (model === pose.exercise)
      return { exercise: model, confidence: Math.max(VIDEO_MODEL_CONFIDENCE, pose.confidence), reason: `${pose.reason} · video AI agrees`, source: "video-model" };
    if (pose.confidence >= POSE_WINS_AT)
      return { exercise: pose.exercise, confidence: pose.confidence, reason: `${pose.reason} (video AI said ${label(model).toLowerCase()})`, source: "pose" };
    return { exercise: model, confidence: VIDEO_MODEL_CONFIDENCE, reason: `video AI saw a ${label(model).toLowerCase()}`, source: "video-model" };
  }
  if (model) return { exercise: model, confidence: VIDEO_MODEL_CONFIDENCE, reason: `video AI saw a ${label(model).toLowerCase()}`, source: "video-model" };
  if (pose) return { exercise: pose.exercise, confidence: pose.confidence, reason: pose.reason, source: "pose" };
  return { exercise: EXERCISE_ORDER[0], confidence: 0.3, reason: "couldn't tell — please confirm", source: "pose" };
}

/** On-device exercise classification; seeks the video, so nothing else may use it meanwhile. */
async function classifyOnDevice(video: HTMLVideoElement, duration: number, signal: AbortSignal) {
  const t0 = now();
  try {
    const r = await detectExercise(video, duration, signal);
    trace({ step: "detect", provider: "mediapipe", model: "pose classifier", ok: !!r, ms: Math.round(now() - t0), detail: r ? `${r.exercise} · ${Math.round(r.confidence * 100)}% · ${r.reason}` : "no clear exercise" });
    return r && isSupportedExercise(r.exercise) ? r : null;
  } catch (e) {
    if (isAbort(e)) throw e;
    trace({ step: "detect", provider: "mediapipe", ok: false, ms: Math.round(now() - t0), error: String(e) });
    return null;
  }
}

/** Probe a clip; the hidden <video> becomes the run's activeVideo unless the run was aborted meanwhile. */
async function probeFor(src: string, signal: AbortSignal) {
  const p = await probeVideo(src);
  if (signal.aborted) {
    disposeVideo(p.video);
    signal.throwIfAborted();
  }
  activeVideo = p.video;
  return p;
}

/** Model events for another exercise keep their timing but drop the (wrong) fault description. */
function eventFor(event: ScanEvent, from: ExerciseId | undefined, to: ExerciseId): ScanEvent {
  if (!from || from === to) return event;
  return { ...event, issue: "hardest_rep", body_part: "full_body", description: `Rep flagged by the video model, which read the set as a ${label(from).toLowerCase()}.` };
}

async function runLive(input: StartInput, signal: AbortSignal) {
  // 1 · Read the video. Uploads are probed through the blob URL the screen already shows.
  const file = input.file;
  if (file) {
    const err = validateFile(file);
    if (err) throw Object.assign(new Error(err.message), { code: err.code });
  }
  const src = file ? store().videoUrl : input.demoId ? `/demo/${input.demoId}/video.mp4` : undefined;
  if (!src) throw Object.assign(new Error("No video selected"), { code: "bad_file_type" });
  void preloadPose().catch(() => undefined);
  const probe = await timed("upload", signal, () => probeFor(src, signal));
  const { video } = probe.value;
  const meta = file ? { ...probe.value.meta, name: file.name, size: file.size, mime: file.type || probe.value.meta.mime } : probe.value.meta;
  store().set({ meta, stage: "sampling" });
  step("upload", { status: "done", ms: probe.ms, label: "Reading your video", note: `${meta.duration.toFixed(1)} s · ${meta.width}×${meta.height}` });

  // 2 · Sample, then scan (network) ∥ classify the exercise on-device (seeks the video).
  step("scan", { status: "active", label: "Watching your set", provider: SCANNING_BADGE });
  const t0 = now();
  const sampled = await sampleFrames(
    video,
    { fps: 4, maxFrames: 40, longEdge: 448, quality: 0.7, burnTimestamp: true },
    (f) => {
      if (!signal.aborted) store().set({ frames: [...store().frames, f] });
    },
  );
  signal.throwIfAborted();
  store().set({ frames: sampled.frames, stage: "scanning" });
  const frames = await fitPayload(sampled.frames, SCAN_PAYLOAD_BUDGET);
  const sheet = await makeContactSheet(sampled.frames, 16).catch(() => undefined);
  signal.throwIfAborted();

  const auto = input.exercise === "auto";
  const scanP = postScan(
    {
      exercise: input.exercise,
      duration: meta.duration,
      effectiveFps: sampled.effectiveFps,
      frames: frames.map((f) => ({ t: f.t, dataUrl: f.dataUrl })),
      contactSheetDataUrl: sheet?.dataUrl,
      contactSheetTimestamps: sheet?.timestamps,
    },
    signal,
  ).then(
    (scan) => ({ ok: true as const, scan }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const tDetect = now();
  const [scanRes, poseGuess] = await Promise.all([scanP, auto ? classifyOnDevice(video, meta.duration, signal) : Promise.resolve(null)]);
  signal.throwIfAborted();

  const modelScan: ScanResult | null = scanRes.ok ? scanRes.scan : null;
  if (modelScan) {
    modelScan.trace.forEach(trace);
  } else if (!scanRes.ok) {
    const e = scanRes.error;
    if (isAbort(e)) throw e;
    (e instanceof ApiClientError ? (e.trace ?? []) : []).forEach(trace);
    trace({ step: "scan", provider: "chain", ok: false, ms: Math.round(now() - t0), error: e instanceof Error ? e.message : String(e) });
  }

  // Exercise: the user's pick, else video model ∥ pose classifier (push-ups and pull-ups only).
  const modelExercise = modelScan && isSupportedExercise(modelScan.exercise) ? modelScan.exercise : undefined;
  const detected: DetectedExercise = auto ? decideExercise(modelExercise, poseGuess) : (store().detected ?? { exercise: input.exercise as ExerciseId, confidence: 1, reason: "you picked it", source: "user" });
  const exercise = detected.exercise;
  store().set({ detected, resolvedExercise: exercise });
  trace({ step: "detect", provider: detected.source, ok: true, ms: auto ? Math.round(now() - tDetect) : 0, detail: detected.reason });

  // Video model down → pose-only scan for the resolved exercise.
  let scan: ScanResult;
  if (modelScan) {
    scan = modelScan;
  } else {
    step("scan", { note: "video AI unavailable — scanning on-device", provider: PROVIDER_LABEL["pose-only"] });
    const t1 = now();
    const events = await poseOnlyScan(video, exercise, meta.duration, signal);
    signal.throwIfAborted();
    trace({ step: "scan", provider: "pose-only", ok: events.length > 0, ms: Math.round(now() - t1), fallback: true });
    scan = { provider: "pose-only", model: "mediapipe-pose-lite", exercise, events, raw: JSON.stringify({ events }, null, 2), trace: [] };
  }
  const n = scan.events.length;
  const fallback = scan.provider === "gpt-fallback" || scan.provider === "pose-only";
  store().set({ scan, stage: "picking" });
  step("scan", {
    status: fallback ? "fallback" : "done",
    ms: Math.round(now() - t0),
    label: "Watching your set",
    provider: PROVIDER_LABEL[scan.provider] ?? scan.provider,
    note:
      scan.provider === "pose-only"
        ? "video AI unavailable — scanned on-device"
        : scan.provider === "gpt-fallback"
          ? "NVIDIA video AI unavailable — used GPT vision"
          : n === 0
            ? "no faults flagged"
            : `${n} moment${n === 1 ? "" : "s"} flagged`,
  });

  // 3 · Pick (refine happens in analyseEvent)
  let events = scan.events;
  let onDevice = scan.provider === "pose-only";
  let eventsExercise = onDevice ? exercise : (scan.exercise ?? (auto ? undefined : exercise));
  let event: ScanEvent | null = pickMoment(events, { duration: meta.duration, exercise });
  if (!event) {
    step("found", { status: "active", label: "Set looks clean — finding your hardest rep" });
    store().set({ stage: "refining" });
    const local = await poseOnlyScan(video, exercise, meta.duration, signal);
    signal.throwIfAborted();
    event = pickMoment(local, { duration: meta.duration, exercise }) ?? local[0] ?? null;
    if (local.length) {
      events = local;
      eventsExercise = exercise;
      onDevice = true;
    }
  }
  event ??= {
    t_start: meta.duration * 0.4,
    t_peak: meta.duration * 0.5,
    t_end: meta.duration * 0.6,
    issue: "hardest_rep",
    body_part: "full_body",
    severity: 1,
    confidence: 0.3,
    description: "No clear fault detected — analysing the middle rep.",
  };
  liveCtx = { video, duration: meta.duration, scan, exercise, events, eventsExercise, onDevice, event };
  await analyseEvent(event, signal);
}

/** Refine → pose/angles → coach (∥ 3D rep capture) for one chosen event, then stage "done". */
async function analyseEvent(event: ScanEvent, signal: AbortSignal) {
  if (!liveCtx) throw new Error("No live video context");
  const { video, duration, exercise, scan, eventsExercise, onDevice } = liveCtx;
  liveCtx.event = event;
  const ev = eventFor(event, eventsExercise, exercise);
  const tf = now();
  step("found", { status: "active", label: "Finding the rep to fix" });
  store().set({ stage: "refining" });
  let moment: ChosenMoment = { t: ev.t_peak, source: onDevice ? "pose-only" : "cosmos", event: ev };
  // On-device events already sit on the measured frame (for their exercise); refining could drift off the fault.
  if (!onDevice || eventsExercise !== exercise) {
    const r = await refineMoment(video, ev, exercise, signal);
    signal.throwIfAborted();
    trace(r.trace);
    if (Math.abs(r.t - ev.t_peak) > 0.01) moment = { ...moment, t: r.t, source: "cosmos+pose-refine", refinedFrom: ev.t_peak };
  }
  store().set({ moment });
  step("found", {
    status: "done",
    ms: Math.round(now() - tf),
    label: `Found the rep to fix at ${clock(moment.t)}`,
    note: ev.issue === "hardest_rep" ? "no clear fault flagged — checking your hardest rep" : undefined,
  });

  // 4 · Pose + angles on the full-res frame
  store().set({ stage: "posing" });
  const posed = await timed("pose", signal, async () => {
    let grabbed = await grabFrame(video, moment.t, { longEdge: 1536 });
    let raw = await detectPose(grabbed.canvas, grabbed.width, grabbed.height);
    for (const dt of [0.15, -0.15, 0.3, -0.3]) {
      if (raw) break;
      signal.throwIfAborted();
      grabbed = await grabFrame(video, Math.max(0, Math.min(duration - 0.05, moment.t + dt)), { longEdge: 1536 });
      raw = await detectPose(grabbed.canvas, grabbed.width, grabbed.height);
    }
    if (!raw) throw Object.assign(new Error("We couldn't see a full body. Film from 2–3 m away with your whole body in frame."), { code: "no_person" });
    const crop = computeCrop(raw, grabbed.width, grabbed.height, exercise);
    const cropped = renderCrop(grabbed.canvas, crop);
    const pose = (await detectPose(cropped.canvas, crop.outW, crop.outH)) ?? transformPose(raw, crop);
    const report = computeAngleReport(pose, exercise);
    return { crop, cropped, pose, report };
  });
  const { crop, cropped, pose: beforePose, report } = posed.value;
  const measured = report.angles.filter((a) => a.value !== null && a.status !== "unmeasurable").length;
  store().set({ crop, beforeImage: cropped.dataUrl, beforePose, angles: report, score: report.score });
  trace({ step: "pose", provider: "mediapipe", model: "pose_landmarker_heavy", ok: true, ms: posed.ms, detail: `${report.view} view · ${report.angles.filter((a) => a.reliable).length} reliable angles` });
  step("pose", { status: "done", ms: posed.ms, label: `Measured ${measured} joint${measured === 1 ? "" : "s"}`, note: `${report.view} view` });

  // 3D rep capture runs alongside the coach (only this branch touches the video now).
  const tRep = now();
  void captureRep(video, moment.t, exercise, signal)
    .then((repFrames) => {
      if (signal.aborted) return;
      store().set({ repFrames });
      trace({ step: "rep3d", provider: "mediapipe", model: "pose_landmarker_lite", ok: repFrames.length > 0, ms: Math.round(now() - tRep), detail: `${repFrames.length} 3D frames` });
    })
    .catch((e) => {
      if (!isAbort(e) && !signal.aborted) trace({ step: "rep3d", ok: false, ms: Math.round(now() - tRep), error: String(e) });
    });

  // 5 · Coach
  store().set({ stage: "coaching" });
  await runCoach({ exercise, report, beforePose, beforeImage: cropped.dataUrl, crop, event: ev, scan, moment }, signal);
  signal.throwIfAborted();
  const s = store();
  const adj = s.coachFallback ? 0 : (s.coach?.form_score_adjustment ?? 0);
  s.set({ stage: "done", score: Math.max(0, Math.min(100, report.score + adj)) });
}

/** Re-run refine → pose → coach for an event of the current live clip (keeps upload/scan). */
async function rerun(event: ScanEvent, patch: Partial<PipelineData> = {}) {
  abortPipeline();
  controller = new AbortController();
  const signal = controller.signal;
  for (const id of ["found", "pose", "coach"] as const) step(id, { status: "pending", ms: undefined, note: undefined, provider: undefined, label: initialLabel(id) });
  store().set({ ...CLEARED_ANALYSIS, ...patch, stage: "refining" });
  try {
    await analyseEvent(event, signal);
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    fail(e);
  }
}

/** Re-run analysis on the next flagged event (UI "Pick another moment"). Live only. */
export async function pickOtherMoment() {
  if (!liveCtx || store().demo) return;
  const { events, event: current } = liveCtx;
  if (events.length < 2) return;
  const idx = events.findIndex((e) => e === current || e.t_peak === current.t_peak);
  await rerun(events[(idx + 1) % events.length]);
}

/**
 * The user corrected the exercise: re-analyse the same moment as `ex`, keeping the video and scan.
 * Live only (no-op in the demo); before the scan has finished it restarts the run with `ex` picked.
 */
export async function reanalyseAs(ex: ExerciseId) {
  const s = store();
  if (s.demo) return;
  if (!liveCtx) {
    if (lastInput) await startPipeline({ ...lastInput, exercise: ex });
    return;
  }
  if (ex === liveCtx.exercise && s.stage !== "error") {
    // Same exercise: just record that the user confirmed it.
    s.set({ detected: { exercise: ex, confidence: 1, reason: "you confirmed it", source: "user" } });
    trace({ step: "detect", provider: "user", ok: true, ms: 0, detail: "you confirmed it" });
    return;
  }
  liveCtx.exercise = ex;
  if (lastInput) lastInput = { ...lastInput, exercise: ex }; // a full retry keeps the user's pick
  const detected: DetectedExercise = { exercise: ex, confidence: 1, reason: "you changed it", source: "user" };
  trace({ step: "detect", provider: "user", ok: true, ms: 0, detail: `${detected.reason} → ${label(ex)}` });
  await rerun(liveCtx.event, { detected, exercise: ex, resolvedExercise: ex });
}

interface AnalysisCtx {
  exercise: ExerciseId;
  report: AngleReport;
  beforePose: PoseResult;
  beforeImage: string;
  crop: { outW: number; outH: number };
  event?: ScanEvent;
  scan: ScanResult;
  moment: ChosenMoment;
}

async function runCoach(ctx: AnalysisCtx, signal: AbortSignal) {
  const t0 = now();
  step("coach", { status: "active", label: "Writing your coaching" });
  const { report } = ctx;
  try {
    const coach = await streamCoach(
      {
        exercise: ctx.exercise,
        view: report.view,
        side: report.side,
        t: ctx.moment.t,
        repIndex: ctx.event?.rep_index,
        cosmosEvent: ctx.event,
        provider: ctx.scan.provider,
        angles: report.angles,
        violations: report.violations,
        keypoints: compactKeypoints(ctx.beforePose),
        frameDataUrl: ctx.beforeImage,
        W: ctx.crop.outW,
        H: ctx.crop.outH,
      },
      {
        signal,
        onDelta: (_full, summary) => {
          if (!signal.aborted) store().set({ coachText: summary });
        },
      },
    );
    signal.throwIfAborted();
    store().set({ coach, coachText: coach.spoken_summary });
    const ms = Math.round(now() - t0);
    trace({ step: "coach", provider: "openai", ok: true, ms });
    step("coach", { status: "done", ms, label: "Coaching ready", provider: "GPT coach" });
  } catch (e) {
    if (isAbort(e) || signal.aborted) throw e;
    const fallback = ruleBasedCoach(report, ctx.event);
    trace({ step: "coach", provider: "openai", ok: false, ms: Math.round(now() - t0), error: String(e), fallback: true });
    store().set({ coach: fallback, coachText: fallback.spoken_summary, coachFallback: true });
    step("coach", { status: "fallback", ms: Math.round(now() - t0), label: "Coaching ready", provider: "Rule-based", note: "AI coach unavailable — rule-based tips" });
  }
}

// ───────────────────── AI photo (on demand) ─────────────────────

function aiPhotoMessage(e: unknown): string {
  const code = e instanceof ApiClientError ? e.code : "";
  switch (code) {
    case "not_configured":
      return "AI photos aren't set up on this server. The 3D replay and target skeleton still show the fix.";
    case "timeout":
      return "The AI photo took too long. Try again in a moment.";
    case "rate_limited":
      return "The image model is busy right now. Try again in a minute.";
    case "correct_rejected":
      return "The image model wouldn't edit this frame. The 3D replay still shows the fix.";
    case "network":
      return "Couldn't reach the AI photo service. Check your connection and try again.";
    default:
      return "Couldn't draw the AI photo this time. Try again.";
  }
}

async function toDataUrl(src: string, signal: AbortSignal): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`Couldn't load the frame (${res.status})`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the frame"));
    r.readAsDataURL(blob);
  });
}

/** Draw the corrected form as a photo (GPT Image edit), then re-measure it. Idempotent while running. */
export async function generateAiPhoto() {
  const s = store();
  if (s.aiPhoto === "generating" || s.aiPhoto === "verifying") return;
  const { angles, beforeImage, beforePose, crop, resolvedExercise: exercise } = s;
  if (!angles || !beforeImage || !crop || !exercise) return;
  photoController?.abort();
  const pc = new AbortController();
  photoController = pc;
  const signal = pc.signal;
  const coach: CoachReport = s.coach ?? ruleBasedCoach(angles, s.moment?.event);
  const primaryFault = (s.coach?.primary_fault.title ?? angles.violations[0]?.label ?? coach.primary_fault.title).slice(0, 200);
  s.set({ aiPhoto: "generating", aiPhotoError: undefined, afterFailed: false, afterImage: undefined, afterPose: undefined, verify: undefined });

  const t0 = now();
  let afterImage: string;
  try {
    const beforeDataUrl = await toDataUrl(beforeImage, signal);
    const res = await postCorrect({ exercise, beforeDataUrl, size: crop.size, correctedPose: coach.corrected_pose, primaryFault }, signal);
    signal.throwIfAborted();
    afterImage = res.imageDataUrl;
    trace({ step: "correct", provider: "openai", model: res.model, ok: true, ms: Math.round(now() - t0) });
    store().set({ afterImage, aiPhoto: "verifying" });
  } catch (e) {
    if (photoController === pc) photoController = null;
    if (isAbort(e) || signal.aborted) return;
    trace({ step: "correct", provider: "openai", ok: false, ms: Math.round(now() - t0), error: e instanceof Error ? e.message : String(e), fallback: true });
    store().set({ aiPhoto: "failed", aiPhotoError: aiPhotoMessage(e), afterFailed: true });
    return;
  }

  const t1 = now();
  try {
    const afterPose = await detectPoseFromUrl(afterImage);
    signal.throwIfAborted();
    if (!afterPose) throw new Error("No person detected in the AI photo");
    if (!beforePose) throw new Error("No measured pose to compare against");
    const report = verifyAfter(angles, beforePose, afterPose, exercise);
    store().set({ afterPose, verify: report, aiPhoto: "done" });
    trace({ step: "verify", provider: "mediapipe", ok: report.passed, ms: Math.round(now() - t1), detail: `${PRIMARY_KEY[exercise]}: ${report.primaryBefore ?? "?"} → ${report.primaryAfter ?? "?"}` });
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    trace({ step: "verify", provider: "mediapipe", ok: false, ms: Math.round(now() - t1), error: e instanceof Error ? e.message : String(e) });
    store().set({ aiPhoto: "done" });
  } finally {
    if (photoController === pc) photoController = null;
  }
}

// ───────────────────────────── DEMO ─────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Missing demo fixture ${url}`);
  return (await r.json()) as T;
}

interface DemoMeta {
  exercise: ExerciseId;
  t: number;
  refinedFrom?: number;
  crop: NonNullable<PipelineData["crop"]>;
  placeholderAfter?: boolean;
}

/** Cached sample run: real probe + filmstrip of the clip, cached scan/pose/coach/after-photo. ~6–8 s. */
async function runDemo(id: DemoId, signal: AbortSignal) {
  // Warm the pose model during the scan animation (only used if after-pose.json is missing).
  void preloadPose({ image: true, video: false }).catch(() => undefined);
  void getJson<{ frames: RepFrame[] }>(demoAsset(id, "rep.json"))
    .then((r) => {
      if (!signal.aborted) store().set({ repFrames: r.frames });
    })
    .catch(() => undefined);

  // 1 · upload (real probe of the local demo clip → real filmstrip)
  const loaded = await timed("upload", signal, () =>
    Promise.all([
      probeFor(`/demo/${id}/video.mp4`, signal),
      getJson<DemoMeta>(demoAsset(id, "meta.json")),
      getJson<ScanResult>(demoAsset(id, "scan.json")),
      getJson<PoseResult>(demoAsset(id, "pose.json")),
      getJson<CoachReport>(demoAsset(id, "coach.json")),
      getJson<PoseResult>(demoAsset(id, "after-pose.json")).catch(() => undefined),
    ]),
  );
  const [{ video, meta: vmeta }, meta, scan, pose, coach, cachedAfterPose] = loaded.value;
  const exercise = meta.exercise;
  store().set({ meta: vmeta, stage: "sampling", resolvedExercise: exercise, detected: { exercise, confidence: 1, reason: "sample clip", source: "demo" } });
  trace({ step: "detect", provider: "demo", ok: true, ms: 0, detail: "sample clip" });
  step("upload", { status: "done", ms: loaded.ms, label: "Reading your video", note: `${vmeta.duration.toFixed(1)} s · ${vmeta.width}×${vmeta.height}` });

  // 2 · scan
  // Cached content is always labelled as cached, whichever model originally produced it.
  const badge = scan.provider === "demo" ? PROVIDER_LABEL.demo : `${PROVIDER_LABEL[scan.provider] ?? scan.provider} · cached`;
  step("scan", { status: "active", label: "Watching your set", provider: badge });
  store().set({ stage: "scanning" });
  const t0 = now();
  // The real filmstrip (for the tape) samples in the background while the cached scan plays.
  const filmstrip = sampleFrames(video, { fps: 1.2, maxFrames: 16, longEdge: 320, quality: 0.6, burnTimestamp: true }, (f) => {
    if (!signal.aborted) store().set({ frames: [...store().frames, f] });
  })
    .catch(() => undefined)
    .finally(() => {
      if (activeVideo === video) disposeActiveVideo();
    });
  await sleep(1600, signal);
  scan.trace.forEach(trace);
  store().set({ scan, stage: "picking" });
  step("scan", { status: "done", ms: Math.round(now() - t0), provider: badge, note: `cached · ${scan.events.length} moments flagged` });

  // 3 · found
  step("found", { status: "active" });
  store().set({ stage: "refining" });
  const tf = now();
  await sleep(600, signal);
  const event = pickMoment(scan.events, { duration: vmeta.duration, exercise }) ?? scan.events[0];
  const moment: ChosenMoment = { t: meta.t, source: "cosmos+pose-refine", event, refinedFrom: meta.refinedFrom ?? event?.t_peak };
  trace({ step: "refine", provider: "mediapipe", model: "cached", ok: true, ms: 0, detail: `refined ${fmtTime(moment.refinedFrom ?? moment.t)} → ${fmtTime(moment.t)}` });
  store().set({ moment });
  step("found", { status: "done", ms: Math.round(now() - tf), label: `Found the rep to fix at ${clock(moment.t)}` });

  // 4 · pose
  store().set({ stage: "posing" });
  step("pose", { status: "active" });
  const tp = now();
  await sleep(500, signal);
  const report = computeAngleReport(pose, exercise);
  const measured = report.angles.filter((a) => a.value !== null && a.status !== "unmeasurable").length;
  const beforeImage = demoAsset(id, "frame.jpg");
  store().set({ crop: meta.crop, beforeImage, beforePose: pose, angles: report, score: report.score });
  const poseMs = Math.round(now() - tp);
  trace({ step: "pose", provider: "mediapipe", model: "pose_landmarker_heavy (cached)", ok: true, ms: poseMs, detail: `${report.view} view` });
  step("pose", { status: "done", ms: poseMs, label: `Measured ${measured} joint${measured === 1 ? "" : "s"}`, note: `${detectView(pose).view} view` });

  // 5 · coach (quick cached stream)
  store().set({ stage: "coaching" });
  step("coach", { status: "active" });
  const tc = now();
  const text = coach.spoken_summary;
  const chunk = Math.max(3, Math.ceil(text.length / 30));
  for (let i = 0; i <= text.length; i += chunk) {
    store().set({ coachText: text.slice(0, i) });
    await sleep(30, signal);
  }
  store().set({ coach, coachText: text });
  const coachMs = Math.round(now() - tc);
  trace({ step: "coach", provider: "openai", model: "cached", ok: true, ms: coachMs });
  step("coach", { status: "done", ms: coachMs, label: "Coaching ready", provider: "Cached" });

  // Cached after-photo is shown automatically for the sample.
  const afterImage = demoAsset(id, "after.jpg");
  trace({ step: "correct", provider: "openai", model: "cached", ok: true, ms: 0, detail: meta.placeholderAfter ? "cached sample photo (real later frame)" : "cached AI photo" });
  const afterPose = cachedAfterPose ?? (await detectPoseFromUrl(afterImage).catch(() => null)) ?? undefined;
  await filmstrip;
  signal.throwIfAborted();
  const verify = afterPose ? verifyAfter(report, pose, afterPose, exercise) : undefined;
  if (verify) trace({ step: "verify", provider: "mediapipe", model: "cached", ok: verify.passed, ms: 0, detail: `${PRIMARY_KEY[exercise]}: ${verify.primaryBefore ?? "?"} → ${verify.primaryAfter ?? "?"}` });
  store().set({
    afterImage,
    afterPose,
    verify,
    aiPhoto: "done",
    stage: "done",
    score: Math.max(0, Math.min(100, report.score + coach.form_score_adjustment)),
  });
}
