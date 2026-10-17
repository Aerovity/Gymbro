"use client";
// Pipeline orchestrator: drives the Zustand store through
// upload → scan (Cosmos chain) → pick + refine → pose/angles → coach ∥ correct → verify.
// Every step writes a TraceEntry; every failure has a fallback so the UI is never empty.
import { usePipelineStore, type StepId, type StepState } from "@/lib/store/pipeline";
import type {
  AngleReport,
  AppError,
  ChosenMoment,
  DemoId,
  ExerciseChoice,
  ExerciseId,
  PoseResult,
  ScanEvent,
  ScanResult,
  TraceEntry,
} from "@/lib/types";
import type { CoachReport, CorrectResponse } from "@/lib/schemas";
import type { RepFrame } from "@/lib/pose3d/skeleton3d";
import { SCAN_PAYLOAD_BUDGET } from "@/lib/schemas";
import { demoAsset } from "@/lib/exercises/catalog";
import { ApiClientError, postCorrect, postScan, streamCoach } from "@/lib/api/client";
import { pickMoment } from "@/lib/moments/pick";
import { computeAngleReport } from "@/lib/angles/compute";
import { detectView } from "@/lib/angles/view";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { verifyAfter } from "@/lib/exercises/verify";
import { PRIMARY_KEY } from "@/lib/exercises/rules";
import { computeCrop, transformPose } from "@/lib/video/crop";
import { compactKeypoints } from "@/lib/pose/compact";
import { isAppErrorException, probeVideo, validateFile } from "@/lib/video/probe";
import { fitPayload, grabFrame, makeContactSheet, renderCrop, sampleFrames } from "@/lib/video/extractFrames";
import { preloadPose } from "@/lib/pose/landmarker";
import { detectPose, detectPoseFromUrl } from "@/lib/pose/detect";
import { captureRep, poseOnlyScan, refineMoment } from "@/lib/moments/refine";

export interface StartInput {
  file?: File;
  demoId?: DemoId;
  exercise: ExerciseChoice;
  /** Run a demo clip through the LIVE pipeline (API routes) instead of cached fixtures. */
  live?: boolean;
}

let controller: AbortController | null = null;
let pending: StartInput | null = null;
let lastInput: StartInput | null = null;
/** Live-run context kept so the user can re-analyse a different flagged moment. */
let liveCtx: { video: HTMLVideoElement; duration: number; exercise: ExerciseId; scan: ScanResult } | null = null;

export const getLastInput = () => lastInput;

/** Landing page → analyze page handoff (File objects can't travel through the URL). */
export function setPendingStart(input: StartInput) {
  pending = input;
}
export function takePendingStart(): StartInput | null {
  const p = pending;
  pending = null;
  return p;
}
let runId = 0;

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

const PROVIDER_LABEL: Record<string, string> = {
  cosmos: "NVIDIA Cosmos",
  nemotron: "NVIDIA Nemotron",
  "gpt-fallback": "GPT vision",
  "pose-only": "On-device pose",
  demo: "Cached",
};

function step(id: StepId, patch: Partial<StepState>) {
  store().setStep(id, patch);
}
function trace(e: TraceEntry) {
  store().addTrace(e);
}
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Wraps a step: marks active, times it, records trace on failure. */
async function timed<T>(id: StepId, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  step(id, { status: "active" });
  const t0 = now();
  const value = await fn();
  return { value, ms: Math.round(now() - t0) };
}

export function abortPipeline() {
  controller?.abort();
  controller = null;
}

export async function startPipeline(input: StartInput) {
  abortPipeline();
  const myRun = ++runId;
  lastInput = input;
  liveCtx = null;
  controller = new AbortController();
  const signal = controller.signal;
  store().reset();
  store().set({
    exercise: input.exercise,
    demoId: input.demoId,
    demo: !!input.demoId && !input.live,
    file: input.file,
    startedAt: Date.now(),
    stage: "probing",
  });
  try {
    if (input.demoId && !input.live) await runDemo(input.demoId, signal);
    else await runLive(input, signal);
  } catch (e) {
    if (isAbort(e) || myRun !== runId) return;
    console.error("[pipeline]", e);
    const s = store();
    const active = s.steps.find((st) => st.status === "active");
    if (active) step(active.id, { status: "failed" });
    const code = isAppErrorException(e) ? e.appError.code : ((e as { code?: AppError["code"] })?.code ?? "unknown");
    const message = isAppErrorException(e) ? e.appError.message : e instanceof Error ? e.message : String(e);
    s.set({ stage: "error", error: { code, message, stage: s.stage } });
  }
}

// ───────────────────────────── LIVE ─────────────────────────────

async function runLive(input: StartInput, signal: AbortSignal) {
  const s = store();
  // 1 · Upload / probe
  const src: File | string | undefined = input.file ?? (input.demoId ? `/demo/${input.demoId}/video.mp4` : undefined);
  if (!src) throw Object.assign(new Error("No video selected"), { code: "bad_file_type" });
  if (input.file) {
    const err = validateFile(input.file);
    if (err) throw Object.assign(new Error(err.message), { code: err.code });
  }
  void preloadPose().catch(() => undefined);
  const probe = await timed("upload", () => probeVideo(src));
  const { video, meta, url } = probe.value;
  s.set({ videoUrl: url, meta, stage: "sampling" });
  step("upload", { status: "done", ms: probe.ms, label: `Read ${meta.duration.toFixed(1)} s · ${meta.width}×${meta.height}` });

  // 2 · Sample + scan
  step("scan", { status: "active", label: "Sampling frames" });
  const t0 = now();
  const sampled = await sampleFrames(
    video,
    { fps: 4, maxFrames: 40, longEdge: 448, quality: 0.7, burnTimestamp: true },
    (f) => store().set({ frames: [...store().frames, f] }),
  );
  let frames = sampled.frames;
  store().set({ frames, stage: "scanning" });
  frames = await fitPayload(frames, SCAN_PAYLOAD_BUDGET);
  const sheet = await makeContactSheet(sampled.frames, 16).catch(() => undefined);
  step("scan", { label: "Scanning video with NVIDIA AI" });

  let scan: ScanResult;
  let scanFallback = false;
  try {
    scan = await postScan(
      {
        exercise: input.exercise,
        duration: meta.duration,
        effectiveFps: sampled.effectiveFps,
        frames: frames.map((f) => ({ t: f.t, dataUrl: f.dataUrl })),
        contactSheetDataUrl: sheet?.dataUrl,
        contactSheetTimestamps: sheet?.timestamps,
      },
      signal,
    );
    scan.trace.forEach(trace);
  } catch (e) {
    if (isAbort(e)) throw e;
    const upstream = e instanceof ApiClientError ? e.trace ?? [] : [];
    upstream.forEach(trace);
    trace({ step: "scan", provider: "chain", ok: false, ms: Math.round(now() - t0), error: e instanceof Error ? e.message : String(e) });
    // Local fallback: pose-only scan across the clip.
    step("scan", { label: "Video model unavailable — scanning on-device", provider: PROVIDER_LABEL["pose-only"] });
    const ex = input.exercise === "auto" ? "pull_up" : input.exercise;
    const t1 = now();
    const events = await poseOnlyScan(video, ex, meta.duration, signal);
    trace({ step: "scan", provider: "pose-only", ok: events.length > 0, ms: Math.round(now() - t1), fallback: true });
    scan = {
      provider: "pose-only",
      model: "mediapipe-pose-lite",
      exercise: ex,
      events,
      raw: JSON.stringify({ events }, null, 2),
      trace: [],
    };
    scanFallback = true;
  }
  const exercise: ExerciseId = input.exercise !== "auto" ? input.exercise : (scan.exercise ?? "pull_up");
  store().set({ scan, resolvedExercise: exercise, stage: "picking" });
  step("scan", {
    status: scanFallback ? "fallback" : "done",
    ms: Math.round(now() - t0),
    provider: PROVIDER_LABEL[scan.provider] ?? scan.provider,
    label: scanFallback
      ? "Video model unavailable — used on-device scan"
      : `Scanned with ${PROVIDER_LABEL[scan.provider] ?? scan.provider} · ${scan.events.length} fault${scan.events.length === 1 ? "" : "s"}`,
    note: scanFallback
      ? "fell back to on-device pose"
      : scan.provider !== "cosmos" && scan.provider !== "demo"
        ? `fell back to ${PROVIDER_LABEL[scan.provider]}`
        : undefined,
  });
  if (scan.provider !== "cosmos" && scan.provider !== "demo") step("scan", { status: "fallback" });

  // 3 · Pick + refine
  liveCtx = { video, duration: meta.duration, exercise, scan };
  let event: ScanEvent | null = pickMoment(scan.events, { duration: meta.duration, exercise });
  if (!event) {
    step("found", { status: "active", label: "Set looks clean — finding your hardest rep" });
    const local = await poseOnlyScan(video, exercise, meta.duration, signal);
    event = pickMoment(local, { duration: meta.duration, exercise }) ?? local[0] ?? null;
  }
  if (!event) {
    event = {
      t_start: meta.duration * 0.4,
      t_peak: meta.duration * 0.5,
      t_end: meta.duration * 0.6,
      issue: "hardest_rep",
      body_part: "full_body",
      severity: 1,
      confidence: 0.3,
      description: "No clear fault detected — analysing the middle rep.",
    };
  }
  await analyseEvent(event, signal);
}

/** Steps 3b–6 for one chosen event: refine → pose/angles → coach ∥ correct → verify. */
async function analyseEvent(event: ScanEvent, signal: AbortSignal) {
  if (!liveCtx) throw new Error("No live video context");
  const { video, duration, exercise, scan } = liveCtx;
  const tf = now();
  step("found", { status: "active", label: "Choosing the clearest bad rep" });
  store().set({ stage: "refining" });
  let moment: ChosenMoment = { t: event.t_peak, source: scan.provider === "pose-only" ? "pose-only" : "cosmos", event };
  // Pose-only events already sit on the measured frame; refining could drift off the fault.
  if (scan.provider !== "pose-only") try {
    const r = await refineMoment(video, event, exercise, signal);
    trace(r.trace);
    if (Math.abs(r.t - event.t_peak) > 0.01) moment = { ...moment, t: r.t, source: "cosmos+pose-refine", refinedFrom: event.t_peak };
  } catch (e) {
    if (isAbort(e)) throw e;
    trace({ step: "refine", ok: false, ms: 0, error: String(e) });
  }
  store().set({ moment });
  step("found", { status: "done", ms: Math.round(now() - tf), label: `Found bad rep at ${fmtTime(moment.t)}` });

  // 4 · Pose + angles on the full-res frame
  store().set({ stage: "posing" });
  const posed = await timed("pose", async () => {
    let grabbed = await grabFrame(video, moment.t, { longEdge: 1536 });
    let raw = await detectPose(grabbed.canvas, grabbed.width, grabbed.height);
    for (const dt of [0.15, -0.15, 0.3, -0.3]) {
      if (raw) break;
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
  store().set({ crop, beforeImage: cropped.dataUrl, beforePose, angles: report, score: report.score });
  trace({ step: "pose", provider: "mediapipe", model: "pose_landmarker_heavy", ok: true, ms: posed.ms, detail: `${report.view} view · ${report.angles.filter((a) => a.reliable).length} reliable angles` });
  step("pose", { status: "done", ms: posed.ms, label: `Mapped skeleton · ${report.view} view` });

  // 3D rep capture runs alongside coach/correct (only this branch touches the video now).
  const tRep = now();
  void captureRep(video, moment.t, exercise, signal)
    .then((repFrames) => {
      if (signal.aborted) return;
      store().set({ repFrames });
      trace({ step: "rep3d", provider: "mediapipe", model: "pose_landmarker_lite", ok: repFrames.length > 0, ms: Math.round(now() - tRep), detail: `${repFrames.length} 3D frames` });
    })
    .catch((e) => {
      if (!isAbort(e)) trace({ step: "rep3d", ok: false, ms: Math.round(now() - tRep), error: String(e) });
    });

  await coachAndCorrect({ exercise, report, beforePose, beforeImage: cropped.dataUrl, crop, event, scan, moment }, signal);
}

/** Re-run analysis on the next flagged event (UI "Pick another moment"). */
export async function pickOtherMoment() {
  const s = store();
  if (!liveCtx || !s.moment) return;
  const events = liveCtx.scan.events;
  if (events.length < 2) return;
  const idx = events.findIndex((e) => e === s.moment?.event || e.t_peak === s.moment?.event?.t_peak);
  const next = events[(idx + 1) % events.length];
  abortPipeline();
  controller = new AbortController();
  const signal = controller.signal;
  for (const id of ["found", "pose", "coach", "correct", "verify"] as StepId[]) step(id, { status: "pending", ms: undefined, note: undefined });
  s.set({ error: undefined, coach: undefined, coachText: "", coachFallback: false, afterImage: undefined, afterPose: undefined, repFrames: undefined, afterFailed: false, verify: undefined, stage: "picking" });
  try {
    await analyseEvent(next, signal);
  } catch (e) {
    if (isAbort(e)) return;
    s.set({ stage: "error", error: { code: "unknown", message: e instanceof Error ? e.message : String(e) } });
  }
}

interface AnalysisCtx {
  exercise: ExerciseId;
  report: AngleReport;
  beforePose: PoseResult;
  beforeImage: string;
  crop: { outW: number; outH: number; size: "1024x1536" | "1536x1024" | "1024x1024" };
  event?: ScanEvent;
  scan: ScanResult;
  moment: ChosenMoment;
}

// ───────────────────── coach ∥ correct → verify ─────────────────────

async function coachAndCorrect(ctx: AnalysisCtx, signal: AbortSignal) {
  store().set({ stage: "coaching" });
  const fallbackCoach = ruleBasedCoach(ctx.report, ctx.event);
  await Promise.allSettled([runCoach(ctx, fallbackCoach, signal), runCorrectAndVerify(ctx, fallbackCoach, signal)]);
  if (signal.aborted) return;
  const s = store();
  const adj = s.coach?.form_score_adjustment ?? 0;
  s.set({ stage: "done", score: Math.max(0, Math.min(100, ctx.report.score + (s.coachFallback ? 0 : adj))) });
}

async function runCoach(ctx: AnalysisCtx, fallback: CoachReport, signal: AbortSignal) {
  const t0 = now();
  step("coach", { status: "active", label: "Coach analysing" });
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
      { signal, onDelta: (_full, summary) => store().set({ coachText: summary }) },
    );
    store().set({ coach, coachText: coach.spoken_summary });
    const ms = Math.round(now() - t0);
    trace({ step: "coach", provider: "openai", ok: true, ms });
    step("coach", { status: "done", ms, label: "Coach report ready", provider: "OpenAI" });
  } catch (e) {
    if (isAbort(e)) throw e;
    trace({ step: "coach", provider: "openai", ok: false, ms: Math.round(now() - t0), error: String(e), fallback: true });
    store().set({ coachFallback: true });
    await typewrite(fallback.spoken_summary, signal);
    store().set({ coach: fallback, coachText: fallback.spoken_summary });
    step("coach", { status: "fallback", ms: Math.round(now() - t0), label: "Rule-based coach (AI unavailable)", note: "rule-based" });
  }
}

async function typewrite(text: string, signal: AbortSignal) {
  for (let i = 0; i <= text.length; i += 4) {
    if (signal.aborted) return;
    store().set({ coachText: text.slice(0, i) });
    await sleep(16, signal).catch(() => undefined);
  }
}

async function runCorrectAndVerify(ctx: AnalysisCtx, fallback: CoachReport, signal: AbortSignal, attempt: 1 | 2 = 1, measuredMiss?: string) {
  const t0 = now();
  store().set({ stage: "correcting", afterFailed: false });
  step("correct", { status: "active", label: attempt === 1 ? "Generating corrected form" : "Regenerating with measured miss" });
  let res: CorrectResponse;
  try {
    res = await postCorrect(
      {
        exercise: ctx.exercise,
        beforeDataUrl: ctx.beforeImage,
        size: ctx.crop.size,
        correctedPose: fallback.corrected_pose,
        primaryFault: fallback.primary_fault.title,
        attempt,
        measuredMiss,
      },
      signal,
    );
  } catch (e) {
    if (isAbort(e)) throw e;
    const ms = Math.round(now() - t0);
    trace({ step: "correct", provider: "openai", ok: false, ms, error: String(e), fallback: true });
    store().set({ afterFailed: true });
    step("correct", { status: "fallback", ms, label: "Showing target skeleton (image model unavailable)", note: "ghost skeleton" });
    step("verify", { status: "skipped", label: "Verify skipped" });
    return;
  }
  const correctMs = Math.round(now() - t0);
  trace({ step: "correct", provider: "openai", model: res.model, ok: true, ms: correctMs, detail: attempt === 2 ? "attempt 2" : undefined });
  store().set({ afterImage: res.imageDataUrl });
  step("correct", { status: "done", ms: correctMs, label: attempt === 1 ? "Corrected form generated" : "Corrected form regenerated", provider: "GPT Image" });
  await verify(ctx, fallback, res.imageDataUrl, signal, attempt, correctMs);
}

async function verify(ctx: AnalysisCtx, fallback: CoachReport, afterUrl: string, signal: AbortSignal, attempt: 1 | 2, correctMs: number) {
  const t0 = now();
  store().set({ stage: "verifying" });
  step("verify", { status: "active", label: "Re-measuring the corrected image" });
  try {
    const afterPose = await detectPoseFromUrl(afterUrl);
    if (!afterPose) throw new Error("No person detected in corrected image");
    const report = verifyAfter(ctx.report, ctx.beforePose, afterPose, ctx.exercise);
    report.attempts = attempt;
    store().set({ afterPose, verify: report });
    const ms = Math.round(now() - t0);
    trace({ step: "verify", provider: "mediapipe", ok: report.passed, ms, detail: `${PRIMARY_KEY[ctx.exercise]}: ${report.primaryBefore ?? "?"} → ${report.primaryAfter ?? "?"}` });
    if (!report.passed && attempt === 1 && correctMs < 45_000 && !signal.aborted) {
      step("verify", { status: "active", label: "Off target — regenerating once" });
      const miss = `${PRIMARY_KEY[ctx.exercise]} measured ${report.primaryAfter ?? "?"}° in the corrected image; it must reach the target.`;
      return runCorrectAndVerify(ctx, fallback, signal, 2, miss);
    }
    step("verify", {
      status: report.passed ? "done" : "fallback",
      ms,
      label: report.passed ? "Verified ✓ angles in range" : "Approximate — AI illustration",
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    trace({ step: "verify", provider: "mediapipe", ok: false, ms: Math.round(now() - t0), error: String(e) });
    step("verify", { status: "fallback", label: "Couldn't re-measure the corrected image" });
  }
}

/** Retry only the image edit (button in the UI). */
export async function retryCorrect() {
  const s = store();
  if (!s.angles || !s.beforePose || !s.beforeImage || !s.crop || !s.resolvedExercise || !s.scan || !s.moment) return;
  controller ??= new AbortController();
  const ctx: AnalysisCtx = {
    exercise: s.resolvedExercise,
    report: s.angles,
    beforePose: s.beforePose,
    beforeImage: s.beforeImage,
    crop: s.crop,
    event: s.moment.event,
    scan: s.scan,
    moment: s.moment,
  };
  await runCorrectAndVerify(ctx, s.coach ?? ruleBasedCoach(s.angles, s.moment.event), controller.signal).catch(() => undefined);
  if (!controller.signal.aborted) store().set({ stage: "done" });
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
  crop: AnalysisCtx["crop"] & { x: number; y: number; w: number; h: number };
  placeholderAfter?: boolean;
}

async function runDemo(id: DemoId, signal: AbortSignal) {
  const s = store();
  // Warm the pose model during the scan animation (only used if after-pose.json is missing).
  void preloadPose({ image: true, video: false }).catch(() => undefined);
  const [meta, scan, pose, coach, afterPose] = await Promise.all([
    getJson<DemoMeta>(demoAsset(id, "meta.json")),
    getJson<ScanResult>(demoAsset(id, "scan.json")),
    getJson<PoseResult>(demoAsset(id, "pose.json")),
    getJson<CoachReport>(demoAsset(id, "coach.json")),
    getJson<PoseResult>(demoAsset(id, "after-pose.json")).catch(() => undefined),
  ]);
  void getJson<{ frames: RepFrame[] }>(demoAsset(id, "rep.json"))
    .then((r) => store().set({ repFrames: r.frames }))
    .catch(() => undefined);
  const exercise = meta.exercise;

  // 1 · upload (real probe of the local demo clip → real filmstrip)
  const probe = await timed("upload", () => probeVideo(`/demo/${id}/video.mp4`));
  const { video, meta: vmeta, url } = probe.value;
  s.set({ videoUrl: url, meta: vmeta, stage: "sampling", resolvedExercise: exercise });
  step("upload", { status: "done", ms: probe.ms, label: `Read ${vmeta.duration.toFixed(1)} s · ${vmeta.width}×${vmeta.height}` });

  // 2 · scan
  step("scan", { status: "active", label: "Sampling frames" });
  const t0 = now();
  await sampleFrames(video, { fps: 2, maxFrames: 24, longEdge: 320, quality: 0.6, burnTimestamp: true }, (f) =>
    store().set({ frames: [...store().frames, f] }),
  );
  store().set({ stage: "scanning" });
  step("scan", { label: "Scanning video with NVIDIA AI" });
  await sleep(1800, signal);
  scan.trace.forEach(trace);
  store().set({ scan, stage: "picking" });
  step("scan", {
    status: "done",
    ms: Math.round(now() - t0),
    provider: PROVIDER_LABEL[scan.provider] ?? "Cached",
    label: `Scanned with ${PROVIDER_LABEL[scan.provider] ?? scan.provider} · ${scan.events.length} faults`,
  });

  // 3 · found
  step("found", { status: "active", label: "Choosing the clearest bad rep" });
  await sleep(700, signal);
  const event = pickMoment(scan.events, { duration: vmeta.duration, exercise }) ?? scan.events[0];
  const moment: ChosenMoment = { t: meta.t, source: "cosmos+pose-refine", event, refinedFrom: meta.refinedFrom ?? event?.t_peak };
  trace({ step: "refine", provider: "mediapipe", ok: true, ms: 640, detail: `refined ${fmtTime(moment.refinedFrom ?? moment.t)} → ${fmtTime(moment.t)}` });
  store().set({ moment });
  step("found", { status: "done", ms: 700, label: `Found bad rep at ${fmtTime(moment.t)}` });

  // 4 · pose
  store().set({ stage: "posing" });
  step("pose", { status: "active" });
  await sleep(600, signal);
  const report = computeAngleReport(pose, exercise);
  const beforeImage = demoAsset(id, "frame.jpg");
  store().set({ crop: meta.crop, beforeImage, beforePose: pose, angles: report, score: report.score });
  trace({ step: "pose", provider: "mediapipe", model: "pose_landmarker_heavy", ok: true, ms: 412, detail: `${report.view} view` });
  step("pose", { status: "done", ms: 412, label: `Mapped skeleton · ${detectView(pose).view} view` });

  // 5 · coach ∥ correct
  store().set({ stage: "coaching" });
  step("coach", { status: "active" });
  step("correct", { status: "active" });
  const coachP = (async () => {
    await sleep(500, signal);
    const text = coach.spoken_summary;
    for (let i = 0; i <= text.length; i += 3) {
      store().set({ coachText: text.slice(0, i) });
      await sleep(28, signal);
    }
    store().set({ coach, coachText: text });
    trace({ step: "coach", provider: "openai", model: "cached", ok: true, ms: 4200 });
    step("coach", { status: "done", ms: 4200, label: "Coach report ready", provider: "Cached" });
  })();
  const correctP = (async () => {
    store().set({ stage: "correcting" });
    await sleep(3600, signal);
    const afterImage = demoAsset(id, "after.jpg");
    store().set({ afterImage });
    trace({ step: "correct", provider: "openai", model: "cached", ok: true, ms: 3600, detail: meta.placeholderAfter ? "placeholder after image" : undefined });
    step("correct", { status: "done", ms: 3600, label: "Corrected form generated", provider: "Cached" });
    step("verify", { status: "active" });
    await sleep(500, signal);
    let ap = afterPose;
    if (!ap) ap = (await detectPoseFromUrl(afterImage).catch(() => null)) ?? undefined;
    if (ap) {
      const v = verifyAfter(report, pose, ap, exercise);
      store().set({ afterPose: ap, verify: v });
      step("verify", { status: v.passed ? "done" : "fallback", ms: 380, label: v.passed ? "Verified ✓ angles in range" : "Approximate — AI illustration" });
    } else {
      step("verify", { status: "fallback", label: "Couldn't re-measure the corrected image" });
    }
  })();
  await Promise.all([coachP, correctP]);
  store().set({ stage: "done", score: Math.max(0, Math.min(100, report.score + coach.form_score_adjustment)) });
}
