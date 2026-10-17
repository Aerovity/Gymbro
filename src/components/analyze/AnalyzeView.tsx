"use client";
// The analysis screen: broadcast header, media (live clip → before/after), score, coach, rundown stepper,
// the tape (filmstrip + Cosmos timeline + mini player) and angle cards. Props only — no store access.
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Box, ChevronDown, Download, Image as ImageIcon, Info, RotateCcw, Share2, Terminal, TriangleAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { Pt, ProviderId, Verdict } from "@/lib/types";
import type { PipelineData, StepId } from "@/lib/store/pipeline";
import { EXERCISE_INFO } from "@/lib/exercises/catalog";
import { formScore } from "@/lib/exercises/score";
import { cn } from "@/lib/utils";
import { Eyebrow, TallyLight, Wordmark } from "@/components/shared/Broadcast";
import { fmtMs } from "@/components/shared/tokens";
import { PipelineStepper, StepperCompact } from "@/components/pipeline/PipelineStepper";
import { ScanVisualizer } from "@/components/pipeline/ScanVisualizer";
import { FoundBanner } from "@/components/pipeline/FoundBanner";
import { BeforeAfter } from "@/components/results/BeforeAfter";
import { FormScore } from "@/components/results/FormScore";
import { CoachPanel } from "@/components/results/CoachPanel";
import { AngleCard, AngleCardSkeleton } from "@/components/results/AngleCard";
import { VideoTimeline } from "@/components/results/VideoTimeline";
import { AgentTrace } from "@/components/results/AgentTrace";
import { ProviderBadge } from "@/components/results/ProviderBadge";
import { EmptyState, ErrorState } from "@/components/results/ErrorState";
import { MediaFrame } from "@/components/results/MediaFrame";
import { LiveMedia } from "./LiveMedia";

// three.js only downloads when the 3D view is opened.
const Form3DView = dynamic(() => import("@/components/three/Form3DView"), {
  ssr: false,
  loading: () => (
    <div className="shimmer flex items-center justify-center rounded-2xl border border-line" style={{ height: "min(74vh, 820px)" }}>
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Loading 3D stage…</span>
    </div>
  ),
});

export interface AnalyzeViewProps {
  data: PipelineData;
  onToggleSkeleton: () => void;
  onToggleVoice: () => void;
  onRetryStep: (step: StepId) => void;
  onUseDemo: () => void;
  onRetryCorrect: () => void;
  onPickOtherMoment: () => void;
  onStartOver: () => void;
  onSeek: (t: number) => void;
  onDownload: () => void;
  onShare: () => void;
  /** Ghost target skeleton (before-image pixel space) for the afterFailed fallback; computed locally if omitted. */
  ghostPoints?: Pt[];
  /** Extra model IDs for the agent-trace sheet. */
  models?: Record<string, string>;
}

const STAGE_ORDER = ["idle", "probing", "sampling", "scanning", "picking", "refining", "posing", "coaching", "correcting", "verifying", "done"] as const;
const atLeast = (stage: PipelineData["stage"], s: (typeof STAGE_ORDER)[number]) =>
  stage !== "error" && STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]) >= STAGE_ORDER.indexOf(s);

const STEP_FOR_STAGE: Partial<Record<PipelineData["stage"], StepId>> = {
  probing: "upload", sampling: "upload", scanning: "scan", picking: "found", refining: "found", posing: "pose", coaching: "coach", correcting: "correct", verifying: "verify",
};

const PROVIDER_LABEL: Record<ProviderId, string> = { cosmos: "NVIDIA Cosmos", nemotron: "NVIDIA Nemotron", "gpt-fallback": "GPT vision", "pose-only": "Pose scan", demo: "Cached demo" };

export function AnalyzeView(props: AnalyzeViewProps) {
  const { data, onToggleSkeleton, onToggleVoice, onRetryStep, onUseDemo, onRetryCorrect, onPickOtherMoment, onStartOver, onSeek, onDownload, onShare, ghostPoints, models } = props;
  const reduce = useReducedMotion();
  const [traceOpen, setTraceOpen] = useState(false);
  const [view3d, setView3d] = useState(false);
  const [rundownOpen, setRundownOpen] = useState(false);
  const [showAllAngles, setShowAllAngles] = useState(false);
  const can3d = !!(data.beforePose?.worldLandmarks?.length && data.angles && data.moment);

  // "3" toggles the 3D replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "3") setView3d((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [miniT, setMiniT] = useState<number | undefined>(undefined);
  const miniRef = useRef<HTMLVideoElement>(null);

  const stage = data.stage;
  const ex = data.resolvedExercise ?? (data.exercise !== "auto" ? data.exercise : undefined);
  const exInfo = ex ? EXERCISE_INFO[ex] : undefined;
  const done = stage === "done";
  const err = stage === "error";
  const duration = data.meta?.duration ?? (data.frames.length ? data.frames[data.frames.length - 1].t + 0.3 : 15);

  // Media geometry: crop output → before pose → video meta → portrait default.
  const mediaW = data.beforePose?.width ?? data.crop?.outW ?? data.meta?.width ?? 720;
  const mediaH = data.beforePose?.height ?? data.crop?.outH ?? data.meta?.height ?? 1280;
  const videoW = data.meta?.width ?? 720;
  const videoH = data.meta?.height ?? 1280;
  const portrait = (data.beforeImage ? mediaW / mediaH : videoW / videoH) < 1.05;

  const scanProvider = data.scan?.provider;
  const providerLabel = scanProvider ? PROVIDER_LABEL[scanProvider] : "NVIDIA video AI";
  const scanFallback = scanProvider === "gpt-fallback" || scanProvider === "pose-only";

  const verifyByKey = useMemo(() => new Map((data.verify?.angles ?? []).map((a) => [a.key, a])), [data.verify]);
  const commentByKey = useMemo(() => new Map((data.coach?.angle_feedback ?? []).map((a) => [a.angle_key, a.comment])), [data.coach]);
  const sortedAngles = useMemo(() => {
    const rank: Record<Verdict, number> = { bad: 0, borderline: 1, good: 2, unmeasurable: 3 };
    return [...(data.angles?.angles ?? [])].sort((a, b) => rank[a.status] - rank[b.status]);
  }, [data.angles]);
  const counts = useMemo(() => {
    const c: Partial<Record<Verdict, number>> = {};
    for (const a of data.angles?.angles ?? []) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [data.angles]);

  const measured = data.angles?.score;
  const finalScore = data.coach ? (data.score ?? (measured != null ? Math.max(0, Math.min(100, measured + data.coach.form_score_adjustment)) : undefined)) : measured;
  const afterScore = useMemo(() => (data.verify?.angles.length ? formScore(data.verify.angles).score : undefined), [data.verify]);
  const totalMs = data.trace.reduce((a, t) => a + (t.ms || 0), 0);
  const retryStep = (STEP_FOR_STAGE[data.error?.stage ?? "idle"] ?? data.steps.find((s) => s.status === "failed")?.id) as StepId | undefined;

  const seek = (t: number) => {
    const v = miniRef.current;
    if (v) {
      try {
        v.currentTime = t;
        setMiniT(t);
      } catch {
        /* ignore */
      }
    }
    onSeek(t);
  };

  const mediaMax = portrait ? "min(74vh, 820px)" : "min(64vh, 720px)";

  // ── Media slot ──
  let media: React.ReactNode;
  if (err && !data.beforeImage) {
    media = (
      <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-signal/30 bg-surface/85">
        <ErrorState
          error={data.error ?? { code: "unknown", message: "Unknown error" }}
          onUseDemo={onUseDemo}
          onRetry={retryStep ? () => onRetryStep(retryStep) : undefined}
          onPickOtherMoment={onPickOtherMoment}
          onStartOver={onStartOver}
        />
      </div>
    );
  } else if (stage === "idle" && !data.videoUrl) {
    media = (
      <MediaFrame width={720} height={1280} maxHeight={mediaMax}>
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <EmptyState
            action={
              <button type="button" data-testid="demo-fallback-btn" onClick={onUseDemo} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-volt px-4 text-sm font-bold text-bg">
                Run the sample clip
              </button>
            }
          />
        </div>
      </MediaFrame>
    );
  } else if (data.beforeImage && view3d && can3d) {
    media = (
      <Form3DView
        repFrames={data.repFrames}
        world={data.beforePose!.worldLandmarks}
        report={data.angles!}
        tMoment={data.moment!.t}
        exercise={ex ?? data.angles!.exercise}
        height={mediaMax}
      />
    );
  } else if (data.beforeImage) {
    media = (
      <div className="relative">
        <BeforeAfter
          beforeImage={data.beforeImage}
          afterImage={data.afterImage}
          beforePose={data.beforePose}
          afterPose={data.afterPose}
          angles={data.angles?.angles}
          verifyAngles={data.verify?.angles}
          width={mediaW}
          height={mediaH}
          showSkeleton={data.showSkeleton}
          pending={stage === "correcting" || (stage === "coaching" && !data.afterImage)}
          afterFailed={data.afterFailed}
          ghostPoints={ghostPoints}
          verifying={stage === "verifying"}
          verifyPassed={data.verify?.passed}
          momentT={data.moment?.t}
          exercise={ex}
          onRetryCorrect={onRetryCorrect}
          maxHeight={mediaMax}
        />
        {stage === "posing" && !data.beforePose && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-5">
            <TallyLight tone="replay">Mapping 33 landmarks…</TallyLight>
          </div>
        )}
      </div>
    );
  } else {
    media = (
      <LiveMedia
        videoUrl={data.videoUrl}
        width={videoW}
        height={videoH}
        stage={stage}
        moment={data.moment}
        framesDone={data.frames.length}
        framesExpected={data.demo ? 24 : 40}
        providerLabel={providerLabel}
        maxHeight={mediaMax}
      />
    );
  }

  const tally = err ? (
    <TallyLight tone="error">Needs attention</TallyLight>
  ) : done ? (
    <TallyLight tone="final">Final</TallyLight>
  ) : stage === "idle" ? (
    <TallyLight tone="idle">Standby</TallyLight>
  ) : (
    <TallyLight tone="live">Analyzing</TallyLight>
  );

  const measuredAngles = sortedAngles.filter((a) => a.status !== "unmeasurable");
  const hiddenAngles = sortedAngles.filter((a) => a.status === "unmeasurable");
  const doneSteps = data.steps.filter((st) => st.status === "done" || st.status === "fallback" || st.status === "skipped").length;
  const showRundownOpen = !done || rundownOpen;

  const iconBtn =
    "inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2/80 text-text transition-colors duration-200 hover:border-dim/50 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40";

  /** One toolbar above the result: view mode left, overlay + export right. */
  const mediaToolbar = data.beforeImage ? (
    <div role="toolbar" aria-label="Result tools" className="mb-3 flex items-center gap-2">
      {can3d ? (
        <div role="radiogroup" aria-label="Result view" className="flex rounded-xl border border-line bg-surface-2/80 p-1">
          {[
            { on: false, label: "Photo", icon: <ImageIcon className="size-3.5" aria-hidden /> },
            { on: true, label: "3D", icon: <Box className="size-3.5" aria-hidden /> },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={view3d === o.on}
              data-testid={o.on ? "view-3d" : "view-photo"}
              onClick={() => setView3d(o.on)}
              title={o.on ? "3D replay (3)" : "Before / after photo"}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors",
                view3d === o.on ? "bg-volt text-bg" : "text-dim hover:text-text",
              )}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <Eyebrow tone="volt">Before / after</Eyebrow>
      )}
      <div className="ml-auto flex items-center gap-2">
        {!view3d && (
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 pl-3 pr-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3" title="Skeleton & angles (S)">
            <Switch data-testid="skeleton-toggle" checked={data.showSkeleton} onCheckedChange={() => onToggleSkeleton()} aria-label="Skeleton and angles" className="data-checked:bg-volt" />
            <span className="hidden sm:inline">Overlay</span>
          </label>
        )}
        <button type="button" data-testid="download-btn" onClick={onDownload} className={iconBtn} aria-label="Download before and after image" title="Download">
          <Download className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={onShare} className={iconBtn} aria-label="Share" title="Share">
          <Share2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  ) : null;

  const rundown = (
    <aside aria-label="Pipeline" className="min-w-0 rounded-2xl border border-line bg-surface/85 p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      {done && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1" aria-hidden>
            {data.steps.map((st) => (
              <span
                key={st.id}
                className={cn("h-1.5 w-5 rounded-full", st.status === "done" ? "bg-volt" : st.status === "fallback" ? "bg-amber" : st.status === "failed" ? "bg-signal" : "bg-surface-3")}
              />
            ))}
          </div>
          <span className="text-[13px] text-dim">
            <span className="font-semibold text-text">{doneSteps}/{data.steps.length} steps</span> · analysed in {fmtMs(totalMs)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-expanded={rundownOpen}
              onClick={() => setRundownOpen((o) => !o)}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-dim transition-colors hover:text-text"
            >
              {rundownOpen ? "Hide steps" : "Show steps"}
              <ChevronDown className={cn("size-4 transition-transform", rundownOpen && "rotate-180")} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="trace-btn"
              onClick={() => setTraceOpen(true)}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-nvidia/40 px-3 text-[13px] font-semibold text-[#9be22d] transition-colors hover:border-nvidia/70 hover:bg-nvidia/10"
            >
              <Terminal className="size-4" aria-hidden />
              Agent trace
            </button>
          </div>
        </div>
      )}
      <div className={cn(done && "mt-4", !showRundownOpen && "hidden")}>
        <PipelineStepper steps={data.steps} onRetryStep={onRetryStep} />
        {!done && data.trace.length > 0 && (
          <button
            type="button"
            data-testid="trace-btn"
            onClick={() => setTraceOpen(true)}
            className="mt-4 flex h-11 w-full cursor-pointer items-center justify-between rounded-xl border border-line bg-bg/40 px-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-dim transition-colors hover:border-nvidia/50 hover:text-text"
          >
            <span>Agent trace</span>
            <span className="tabular text-text">{data.trace.length} calls · {fmtMs(totalMs)}</span>
          </button>
        )}
      </div>
    </aside>
  );

  const angles = (
    <section aria-label="Joint angles" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Eyebrow tone="cyan">Measured angles</Eyebrow>
        {data.angles && (
          <span className="text-[12.5px] text-dim">
            {measuredAngles.length} measured · {data.angles.view === "front" ? "front / rear view" : `${data.angles.view} view`}
          </span>
        )}
        {data.verify && (
          <span className={cn("ml-auto text-[12.5px] font-semibold", data.verify.passed ? "text-volt" : "text-amber")}>
            {data.verify.passed ? "✓ Fix verified on the after image" : "! Fix only partly verified"}
          </span>
        )}
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0">
        {data.angles
          ? (showAllAngles ? sortedAngles : measuredAngles).map((m, i) => (
              <AngleCard key={m.key} m={m} after={verifyByKey.get(m.key)} comment={commentByKey.get(m.key)} index={i} className="w-[82%] shrink-0 snap-center md:w-auto" />
            ))
          : [0, 1].map((i) => <AngleCardSkeleton key={i} className={cn("w-[82%] shrink-0 snap-center md:w-auto", !atLeast(stage, "posing") && "opacity-50")} />)}
      </div>
      {!data.angles && (
        <p className="mt-2 text-[13px] text-dim">{atLeast(stage, "posing") ? "Measuring every joint on the flagged frame…" : "Joint angles appear once the bad rep is found."}</p>
      )}
      {data.angles && hiddenAngles.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAllAngles((v) => !v)}
          className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-2.5 text-left text-[13px] text-dim transition-colors hover:border-dim/50 hover:text-text"
        >
          <Info className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {showAllAngles
              ? "Hide checks we couldn't measure"
              : `${hiddenAngles.length} more check${hiddenAngles.length === 1 ? "" : "s"} need${hiddenAngles.length === 1 ? "s" : ""} a clearer camera angle — ${exInfo?.cameraHint ?? "film the whole body side-on."}`}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", showAllAngles && "rotate-180")} aria-hidden />
        </button>
      )}
    </section>
  );

  const tape = (
    <section aria-label="The tape" className="min-w-0 rounded-2xl border border-line bg-surface/85 p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Eyebrow tone="nvidia">The tape</Eyebrow>
        <span className="text-[12.5px] tabular text-dim">
          {stage === "probing" || stage === "sampling"
            ? `Sampling frames · ${data.frames.length}`
            : stage === "scanning"
              ? `${providerLabel} is watching ${data.frames.length} frames…`
              : data.scan
                ? `${data.scan.events.length} moment${data.scan.events.length === 1 ? "" : "s"} flagged by ${data.demo ? "the video model" : providerLabel}${data.scan.repCount != null ? ` · ${data.scan.repCount} reps` : ""}`
                : `${duration.toFixed(1)} s clip`}
        </span>
        {data.moment && <FoundBanner moment={data.moment} variant="bar" testId="found-banner" className="w-full sm:ml-auto sm:w-auto" />}
      </div>
      <div className="flex gap-4">
        {data.beforeImage && data.videoUrl && (
          <div className="relative hidden shrink-0 overflow-hidden rounded-lg border border-line bg-black sm:block" style={{ height: 150, aspectRatio: `${videoW} / ${videoH}` }}>
            <video ref={miniRef} src={data.videoUrl} muted playsInline controls={false} preload="auto" onLoadedMetadata={(e) => { if (data.moment) e.currentTarget.currentTime = data.moment.t; }} onTimeUpdate={(e) => setMiniT(e.currentTarget.currentTime)} onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())} className="h-full w-full cursor-pointer object-cover" aria-label="Mini player — click to play or pause" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <ScanVisualizer frames={data.frames} stage={stage} duration={duration} events={data.scan?.events} chosenT={data.moment?.t} />
          <VideoTimeline duration={duration} events={data.scan?.events ?? []} chosen={data.moment} currentTime={miniT} onSeek={seek} className="mt-1" />
        </div>
      </div>
      {data.scan?.overall && (
        <p className="mt-3 text-[13.5px] leading-snug text-dim">
          <span className="font-semibold text-text">Video model verdict: </span>
          {data.scan.overall}
        </p>
      )}
    </section>
  );

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn("mx-auto w-full max-w-[1400px] px-4 pb-28 pt-4 sm:px-6 lg:pb-12")}
      data-stage={stage}
    >
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line pb-4">
        <Link href="/" className="rounded-lg" aria-label="Gym Bro home">
          <Wordmark />
        </Link>
        <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
        {tally}
        {exInfo && <span className="hidden font-display text-xl uppercase tracking-wide text-text sm:inline">{exInfo.label}</span>}
        <div className="ml-auto flex items-center gap-2">
          {data.demo ? (
            <span className="hidden h-9 items-center rounded-lg border border-line bg-surface-2/80 px-3 text-[12.5px] font-semibold text-dim md:inline-flex">Sample clip · cached run</span>
          ) : (
            scanProvider && <ProviderBadge provider={scanProvider} size="md" className="hidden md:inline-flex" />
          )}
          <button type="button" onClick={onStartOver} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-3.5 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3" aria-label="Start over with a new clip">
            <RotateCcw className="size-4" aria-hidden />
            <span className="hidden sm:inline">New clip</span>
          </button>
        </div>
      </header>

      {scanFallback && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3.5 py-2.5 text-[13px] text-amber" role="status">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {scanProvider === "pose-only" ? "The video model was unavailable, so we scanned your set on-device with pose tracking." : "The NVIDIA video model was unavailable — GPT vision scanned the set instead."}
          </span>
          {!data.demo && (
            <button
              type="button"
              data-testid="demo-fallback-btn"
              onClick={onUseDemo}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-amber/50 px-2.5 text-[12px] font-semibold text-amber transition-colors hover:bg-amber/15"
            >
              Run demo results
            </button>
          )}
        </div>
      )}

      <div className={cn("grid grid-cols-1 gap-5", portrait ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : "lg:grid-cols-1")}>
        {/* Media column */}
        <div className="min-w-0">
          <div className="lg:sticky lg:top-4">
            {mediaToolbar}
            {media}
          </div>
        </div>

        {/* Insight column */}
        <div className="flex min-w-0 flex-col gap-5">
          {!done && !err && rundown}
          <FormScore
            wide
            score={finalScore}
            measured={measured}
            adjustment={data.coach?.form_score_adjustment}
            grade={finalScore != null && data.coach ? undefined : data.angles?.grade}
            headline={data.coach?.headline}
            counts={data.angles ? counts : undefined}
            afterScore={afterScore}
            loading={atLeast(stage, "posing") && !data.angles}
          />
          <CoachPanel
            text={data.coachText}
            coach={data.coach}
            streaming={stage === "coaching"}
            waiting={atLeast(stage, "posing") && !data.coach && !err}
            fallback={data.coachFallback}
            voiceOn={data.voiceOn}
            onToggleVoice={onToggleVoice}
            onRetry={data.coachFallback ? () => onRetryStep("coach") : undefined}
            providerLabel={data.demo ? "Cached demo" : undefined}
          />
          {angles}
          {(done || err) && rundown}
        </div>
      </div>

      <div className="mt-5">{tape}</div>

      {/* Mobile bottom progress */}
      {!done && !err && stage !== "idle" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg lg:hidden">
          <StepperCompact steps={data.steps} />
        </div>
      )}

      <AgentTrace open={traceOpen} onOpenChange={setTraceOpen} trace={data.trace} scan={data.scan} moment={data.moment} models={models} />
    </motion.div>
  );
}
