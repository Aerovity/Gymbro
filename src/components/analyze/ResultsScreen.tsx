"use client";
// Mode B: results, all at once. Media card (Photo | 3D) with the target-form ghost and the optional AI photo,
// ONE verdict card, "What we measured", and everything technical folded into "Under the hood".
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Box, ChevronDown, Download, Image as ImageIcon, Info, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import type { ExerciseId, Pt, Verdict } from "@/lib/types";
import type { PipelineData, StepId } from "@/lib/store/pipeline";
import { cn } from "@/lib/utils";
import { LogoMark, Eyebrow, TallyLight } from "@/components/shared/Broadcast";
import { fmtValue } from "@/components/shared/tokens";
import { exerciseInfo, exerciseLabel } from "@/components/shared/exercise";
import { Switch } from "@/components/ui/switch";
import { BeforeAfter } from "@/components/results/BeforeAfter";
import { AiPhotoPanel } from "@/components/results/AiPhotoPanel";
import { VerdictCard } from "@/components/results/VerdictCard";
import { AngleCard } from "@/components/results/AngleCard";
import { ProviderBadge } from "@/components/results/ProviderBadge";
import { computeGhostPoints } from "@/components/results/overlayGeometry";
import { LiveMedia } from "./LiveMedia";
import { ExerciseBadge } from "./ExerciseBadge";
import { UnderTheHood } from "./UnderTheHood";

// three.js only downloads when the 3D view is opened.
const Form3DView = dynamic(() => import("@/components/three/Form3DView"), {
  ssr: false,
  loading: () => (
    <div className="shimmer flex items-center justify-center rounded-2xl border border-line" style={{ height: "var(--media-h)" }}>
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Loading 3D stage…</span>
    </div>
  ),
});

export interface ResultsScreenProps {
  data: PipelineData;
  exercise?: ExerciseId;
  providerLabel: string;
  fallbackNotice: string | null;
  ghostPoints?: Pt[];
  onToggleSkeleton: () => void;
  onToggleVoice: () => void;
  onRetryStep: (step: StepId) => void;
  onUseDemo: () => void;
  onGenerateAiPhoto: () => void;
  onChangeExercise: (ex: ExerciseId) => void;
  onPickOtherMoment: () => void;
  onStartOver: () => void;
  onSeek: (t: number) => void;
  onDownload: () => void;
  onShare: () => void;
  onOpenTrace: () => void;
}

const RANK: Record<Verdict, number> = { bad: 0, borderline: 1, good: 2, unmeasurable: 3 };
const iconBtn =
  "inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2/80 text-text transition-colors duration-200 hover:border-dim/50 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40";

export function ResultsScreen(props: ResultsScreenProps) {
  const { data, exercise, providerLabel, fallbackNotice, ghostPoints, onToggleSkeleton, onToggleVoice, onRetryStep, onUseDemo, onGenerateAiPhoto, onChangeExercise, onPickOtherMoment, onStartOver, onSeek, onDownload, onShare, onOpenTrace } = props;
  const reduce = useReducedMotion();
  const [view3d, setView3d] = useState(false);
  const [showGhost, setShowGhost] = useState(true);
  const [showAllAngles, setShowAllAngles] = useState(false);

  const can3d = !!(data.beforePose?.worldLandmarks?.length && data.angles && data.moment);
  const ex = exercise ?? data.angles?.exercise;
  const exInfo = exerciseInfo(ex);

  // "3" toggles the 3D replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "3" && can3d) setView3d((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [can3d]);

  // ── Geometry ──
  const videoW = data.meta?.width ?? 720;
  const videoH = data.meta?.height ?? 1280;
  const mediaW = data.beforePose?.width ?? data.crop?.outW ?? videoW;
  const mediaH = data.beforePose?.height ?? data.crop?.outH ?? videoH;
  const ratio = data.beforeImage ? mediaW / mediaH : videoW / videoH;
  const portrait = ratio < 1.05;
  const duration = data.meta?.duration ?? (data.frames.length ? data.frames[data.frames.length - 1].t + 0.3 : 15);

  // ── Angles ──
  const verifyByKey = useMemo(() => new Map((data.verify?.angles ?? []).map((a) => [a.key, a])), [data.verify]);
  const commentByKey = useMemo(() => new Map((data.coach?.angle_feedback ?? []).map((a) => [a.angle_key, a.comment])), [data.coach]);
  // Scored measurements first (worst first), then low-confidence estimates.
  const sortedAngles = useMemo(() => [...(data.angles?.angles ?? [])].sort((a, b) => Number(!a.reliable) - Number(!b.reliable) || RANK[a.status] - RANK[b.status]), [data.angles]);
  const measuredAngles = sortedAngles.filter((a) => a.status !== "unmeasurable");
  const hiddenAngles = sortedAngles.filter((a) => a.status === "unmeasurable");
  const counts = useMemo(() => {
    const c: Partial<Record<Verdict, number>> = {};
    for (const a of data.angles?.angles ?? []) if (a.reliable && a.status !== "unmeasurable") c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [data.angles]);

  // Low-confidence estimates are listed below but never drawn on the photo as faults.
  const overlayAngles = useMemo(() => data.angles?.angles.filter((a) => a.reliable), [data.angles]);
  const overlayVerify = useMemo(() => data.verify?.angles.filter((a) => a.reliable), [data.verify]);

  // ── Score ──
  const measured = data.angles?.score;
  const finalScore = data.coach ? (data.score ?? (measured != null ? Math.max(0, Math.min(100, measured + data.coach.form_score_adjustment)) : undefined)) : (data.score ?? measured);
  const grade = data.coach ? undefined : data.angles?.grade;
  const fallbackHeadline = data.angles?.violations[0] ? `Fix your ${data.angles.violations[0].label.toLowerCase()}` : data.angles ? "Solid rep — keep it up" : undefined;

  // ── Target form (ghost) + AI photo ──
  const hasAfter = !!data.afterImage;
  const ghost = useMemo(() => {
    if (ghostPoints?.length) return ghostPoints;
    if (!data.beforePose || !data.angles) return undefined;
    const fixable = data.angles.angles.some((m) => (m.status === "bad" || m.status === "borderline") && m.unit === "°" && m.points && m.target);
    return fixable ? computeGhostPoints(data.beforePose, data.angles.angles) : undefined;
  }, [ghostPoints, data.beforePose, data.angles]);
  const aiFailed = data.aiPhoto === "failed" || (data.afterFailed && data.aiPhoto !== "generating" && data.aiPhoto !== "verifying");
  const aiState = aiFailed ? "failed" : data.aiPhoto;
  const verifyLine = useMemo(() => {
    const v = data.verify;
    if (!v || v.primaryBefore == null || v.primaryAfter == null) return undefined;
    const m = data.angles?.angles.find((a) => a.key === v.primaryKey);
    const unit = m?.unit ?? "°";
    return `${m?.label ?? "Main angle"} ${fmtValue(v.primaryBefore, unit)} → ${fmtValue(v.primaryAfter, unit)}${v.passed ? " ✓" : ""}`;
  }, [data.verify, data.angles]);

  const coachProvider = data.demo ? "Cached" : data.coachFallback ? "rules" : "OpenAI GPT";
  const modelBadges = [providerLabel, "MediaPipe", data.demo ? "GPT coach · cached" : data.coachFallback ? "Rule-based coach" : "OpenAI GPT", ...(hasAfter && !data.demo ? ["GPT Image"] : [])];

  const enter = (d: number) =>
    reduce ? { initial: false as const } : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: d, ease: [0.2, 0.8, 0.2, 1] as const } };

  // ── Media ──
  let media: React.ReactNode;
  if (data.beforeImage && view3d && can3d) {
    media = (
      <div className="relative">
        <Form3DView repFrames={data.repFrames} world={data.beforePose!.worldLandmarks} report={data.angles!} tMoment={data.moment!.t} exercise={ex ?? data.angles!.exercise} height="var(--media-h)" />
      </div>
    );
  } else if (data.beforeImage) {
    media = (
      <BeforeAfter
        beforeImage={data.beforeImage}
        afterImage={data.afterImage}
        beforePose={data.beforePose}
        afterPose={data.afterPose}
        angles={overlayAngles}
        verifyAngles={overlayVerify}
        width={mediaW}
        height={mediaH}
        showSkeleton={data.showSkeleton}
        showGhost={showGhost && !!ghost}
        ghostPoints={ghost}
        pending={data.aiPhoto === "generating" || (data.aiPhoto === "verifying" && !hasAfter)}
        verifying={data.aiPhoto === "verifying" && hasAfter}
        verifyPassed={data.verify?.passed}
        momentT={data.moment?.t}
        afterLabel={data.demo ? "After · cached AI photo" : "After · AI photo"}
        maxHeight="var(--media-h)"
      />
    );
  } else {
    media = <LiveMedia videoUrl={data.videoUrl} width={videoW} height={videoH} stage={data.stage} moment={data.moment} framesDone={data.frames.length} providerLabel={providerLabel} maxHeight="var(--media-h)" />;
  }

  const toolbar = (
    <div role="toolbar" aria-label="Result tools" className="mb-3 flex items-center gap-2">
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
            disabled={o.on && !can3d}
            onClick={() => setView3d(o.on)}
            title={o.on ? (can3d ? "Your rep vs the corrected rep in 3D (3)" : "3D needs a measured pose") : "Your frame"}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              view3d === o.on ? "bg-volt text-bg" : "text-dim hover:text-text",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
      {view3d && !data.repFrames?.length && (
        <TallyLight tone="replay" className="hidden sm:inline-flex">
          Building your 3D rep…
        </TallyLight>
      )}
      <div className="ml-auto flex items-center gap-2">
        {!view3d && (
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3" title="Skeleton & angles (S)">
            <Switch data-testid="skeleton-toggle" checked={data.showSkeleton} onCheckedChange={() => onToggleSkeleton()} aria-label="Skeleton and angles" className="data-checked:bg-volt" />
            <span className="hidden sm:inline">Overlay</span>
          </label>
        )}
        <button type="button" data-testid="download-btn" onClick={onDownload} disabled={!data.beforeImage} className={iconBtn} aria-label="Download result image" title="Download">
          <Download className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={onShare} disabled={!data.beforeImage} className={iconBtn} aria-label="Share" title="Share">
          <Share2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );

  const measuredSection = (
    <motion.section {...enter(0.2)} aria-label="What we measured" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Eyebrow tone="cyan">What we measured</Eyebrow>
        {data.angles && (
          <span className="text-[12.5px] text-dim">
            {measuredAngles.length} {measuredAngles.length === 1 ? "angle" : "angles"} · {data.angles.view === "front" ? "front / rear view" : data.angles.view === "unknown" ? "camera angle unclear" : `${data.angles.view} view`}
          </span>
        )}
        {data.verify && hasAfter && (
          <span className={cn("ml-auto text-[12.5px] font-semibold", data.verify.passed ? "text-volt" : "text-amber")}>{data.verify.passed ? "✓ Fix verified on the AI photo" : "! Fix only partly verified"}</span>
        )}
      </div>
      {measuredAngles.length > 0 || showAllAngles ? (
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0">
          {(showAllAngles ? sortedAngles : measuredAngles).map((m, i) => (
            <AngleCard key={m.key} m={m} after={hasAfter ? verifyByKey.get(m.key) : undefined} comment={commentByKey.get(m.key)} index={i} className="w-[84%] shrink-0 snap-center sm:w-auto" />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-[13.5px] text-dim">No joint angle was clear enough to measure on this frame.</p>
      )}
      {hiddenAngles.length > 0 && (
        <button
          type="button"
          aria-expanded={showAllAngles}
          onClick={() => setShowAllAngles((v) => !v)}
          className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-2.5 text-left text-[13px] text-dim transition-colors hover:border-dim/50 hover:text-text"
        >
          <Info className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {showAllAngles
              ? "Hide the checks we couldn't measure"
              : `${hiddenAngles.length} more check${hiddenAngles.length === 1 ? "" : "s"} need${hiddenAngles.length === 1 ? "s" : ""} a clearer camera angle — ${exInfo?.cameraHint ?? "film the whole body side-on."}`}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", showAllAngles && "rotate-180")} aria-hidden />
        </button>
      )}
    </motion.section>
  );

  return (
    <div
      className="mx-auto w-full max-w-[1320px] px-4 pb-16 sm:px-6 [--media-h:min(62svh,600px)] lg:[--media-h:min(68vh,760px)]"
      style={{ "--media-w": `calc(var(--media-h) * ${ratio.toFixed(4)})` } as React.CSSProperties}
      data-testid="results-screen"
    >
      {/* Header */}
      <header className="flex h-[68px] items-center gap-3 border-b border-line">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Gym Bro home">
          <LogoMark className="size-7" />
          <span className="hidden font-display text-[22px] uppercase leading-none tracking-[0.06em] text-text sm:inline">
            Gym<span className="text-volt">Bro</span>
          </span>
        </Link>
        <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
        {ex && <ExerciseBadge exercise={ex} detected={data.detected} demo={data.demo} showNote={!data.demo} onChange={data.demo ? undefined : onChangeExercise} />}
        {data.demo && <span className="hidden h-8 items-center rounded-lg border border-line bg-surface-2/60 px-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-dim sm:inline-flex">Sample · cached results</span>}
        <div className="ml-auto flex items-center gap-2">
          {!data.demo && data.scan && <ProviderBadge provider={data.scan.provider} size="md" className="hidden lg:inline-flex" />}
          <button type="button" onClick={onStartOver} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-3.5 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3" aria-label="Start over with a new clip">
            <RotateCcw className="size-4" aria-hidden />
            <span className="hidden sm:inline">New clip</span>
          </button>
        </div>
      </header>

      {fallbackNotice && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line/60 py-2.5 text-[12.5px] text-amber/90">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{fallbackNotice}</span>
          {!data.demo && (
            <button type="button" data-testid="demo-fallback-btn" onClick={onUseDemo} className="cursor-pointer rounded-md px-1.5 py-1 font-semibold text-amber underline-offset-4 hover:underline">
              Use the sample results instead
            </button>
          )}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,min(var(--media-w),58%))_minmax(0,1fr)] lg:gap-10">
        {/* Media */}
        <motion.div {...enter(0)} className="min-w-0">
          <div className="lg:sticky lg:top-6">
            {toolbar}
            {media}
            {!view3d && data.beforeImage && (
              <AiPhotoPanel
                className="mt-3"
                state={aiState}
                error={data.aiPhotoError}
                exercise={ex}
                hasAfter={hasAfter}
                cached={data.demo}
                showGhost={showGhost}
                onToggleGhost={() => setShowGhost((g) => !g)}
                canGhost={!!ghost}
                onGenerate={onGenerateAiPhoto}
                verifyLine={verifyLine}
                verifyPassed={data.verify?.passed}
              />
            )}
            {view3d && (
              <p className="mt-3 px-1 text-[12.5px] text-dim">
                Your rep next to the corrected rep. Drag to orbit<span className="hidden sm:inline"> · press 3 for the photo</span>.
              </p>
            )}
          </div>
        </motion.div>

        {/* Verdict → Under the hood (+ measurements when the media is portrait) */}
        <div className="flex min-w-0 flex-col gap-8">
          <motion.div {...enter(0.1)}>
            <VerdictCard
              score={finalScore}
              measured={measured}
              grade={grade}
              headline={data.coach?.headline ?? fallbackHeadline}
              counts={data.angles ? counts : undefined}
              coachText={data.coachText}
              coach={data.coach}
              streaming={!data.coach && !!data.coachText}
              fallback={data.coachFallback}
              coachProvider={coachProvider}
              voiceOn={data.voiceOn}
              onToggleVoice={onToggleVoice}
              onRetryCoach={data.coachFallback ? () => onRetryStep("coach") : undefined}
            />
          </motion.div>
          {/* Under the hood sits right behind the verdict, same column width */}
          <motion.div {...enter(0.15)}>
            <UnderTheHood
              stage={data.stage}
              steps={data.steps}
              trace={data.trace}
              frames={data.frames}
              duration={duration}
              scan={data.scan}
              moment={data.moment}
              videoUrl={data.videoUrl}
              videoW={videoW}
              videoH={videoH}
              providerLabel={providerLabel}
              demo={data.demo}
              modelBadges={modelBadges}
              onSeek={onSeek}
              onRetryStep={onRetryStep}
              onPickOtherMoment={onPickOtherMoment}
              onOpenTrace={onOpenTrace}
            />
          </motion.div>
          {portrait && measuredSection}
        </div>
      </div>

      {!portrait && <div className="mt-10">{measuredSection}</div>}

      <p className="mt-8 text-center text-[12px] text-dim/80">{exerciseLabel(ex)} form check · measured with MediaPipe Pose · not medical advice.</p>
    </div>
  );
}
