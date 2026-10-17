"use client";
// Mode A: one calm, focused "Analyzing your video" screen — the user's own clip in broadcast chrome
// next to a 5-step checklist with live sub-lines, a subtle progress bar and the detected exercise.
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { TriangleAlert, X } from "lucide-react";
import type { PipelineData, StepId } from "@/lib/store/pipeline";
import type { ExerciseId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Eyebrow, Wordmark } from "@/components/shared/Broadcast";
import { PipelineStepper, stepProgress } from "@/components/pipeline/PipelineStepper";
import { LiveMedia } from "./LiveMedia";
import { ExerciseBadge } from "./ExerciseBadge";

export interface AnalyzingScreenProps {
  data: PipelineData;
  exercise?: ExerciseId;
  providerLabel: string;
  /** Short notice when the video model fell back (null = no fallback). */
  fallbackNotice: string | null;
  onUseDemo: () => void;
  onStartOver: () => void;
  onRetryStep: (step: StepId) => void;
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Seconds since the run started (ticks once a second; 0 until mounted). */
function useElapsed(startedAt: number | undefined, running: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [running]);
  if (!startedAt || now == null) return 0;
  return Math.max(0, (now - startedAt) / 1000);
}

export function AnalyzingScreen({ data, exercise, providerLabel, fallbackNotice, onUseDemo, onStartOver, onRetryStep }: AnalyzingScreenProps) {
  const videoW = data.meta?.width ?? 720;
  const videoH = data.meta?.height ?? 1280;
  const portrait = videoW / videoH < 1.05;
  const progress = stepProgress(data.steps);
  const activeIdx = data.steps.findIndex((s) => s.status === "active");
  const doneCount = data.steps.filter((s) => s.status === "done" || s.status === "fallback" || s.status === "skipped").length;
  const stepNo = activeIdx >= 0 ? activeIdx + 1 : Math.min(data.steps.length, doneCount + 1);
  const elapsed = useElapsed(data.startedAt, data.stage !== "idle");
  const detectedEx = data.detected?.exercise ?? exercise;

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-[1240px] flex-col px-4 sm:px-6" data-testid="analyzing-screen">
      <header className="flex h-[68px] shrink-0 items-center gap-3">
        <Link href="/" className="rounded-lg" aria-label="Gym Bro home">
          <Wordmark />
        </Link>
        <button
          type="button"
          onClick={onStartOver}
          className="ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-dim transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Cancel and upload a different clip"
        >
          <X className="size-4" aria-hidden />
          Cancel
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center pb-10 pt-1 sm:items-center sm:pt-2 lg:pb-16">
        <div
          className={cn(
            "grid w-full items-center gap-6 sm:gap-9 lg:gap-16",
            portrait ? "max-w-[980px] lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]" : "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,420px)]",
            "[--player-h:min(38svh,420px)] sm:[--player-h:min(52svh,600px)] lg:[--player-h:min(72vh,760px)]",
          )}
        >
          {/* The user's own clip */}
          <div className="relative min-w-0">
            <div aria-hidden className="pointer-events-none absolute inset-x-[10%] -inset-y-6 rounded-[48px] bg-[radial-gradient(closest-side,rgb(46_230_255/0.12),transparent)] blur-2xl" />
            <LiveMedia
              videoUrl={data.videoUrl}
              width={videoW}
              height={videoH}
              stage={data.stage}
              moment={data.moment}
              frameImage={data.beforeImage}
              framePose={data.beforePose}
              framesDone={data.frames.length}
              providerLabel={providerLabel}
              maxHeight="var(--player-h)"
              className={portrait ? "lg:mr-0" : undefined}
            />
          </div>

          {/* Checklist */}
          <div className="min-w-0">
            <Eyebrow tone="cyan">{activeIdx < 0 && doneCount === data.steps.length ? "Putting your results together" : `Step ${stepNo} of ${data.steps.length}`}</Eyebrow>
            <h1 className="mt-2.5 font-display text-[clamp(30px,3.3vw,46px)] uppercase leading-[0.95] tracking-[0.01em] text-text sm:mt-3">Analyzing your video</h1>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[14.5px] text-dim">
              <span>Usually 30–60 seconds.</span>
              {elapsed > 0 && <span className="font-mono text-[12.5px] tabular text-dim/80">{fmtClock(elapsed)} elapsed</span>}
            </p>

            <div className="mt-4 flex min-h-10 flex-wrap items-center gap-2 sm:mt-5">
              {data.detected && detectedEx ? (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                  <ExerciseBadge exercise={detectedEx} detected={data.detected} demo={data.demo} prefix={data.detected.source === "user" || data.demo ? undefined : "Detected:"} />
                </motion.div>
              ) : (
                <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-dashed border-line px-3 text-[13px] text-dim">
                  <span className="size-1.5 animate-tally rounded-full bg-cyan" aria-hidden />
                  {data.exercise === "auto" ? "Detecting push-ups or pull-ups…" : "Getting ready…"}
                </span>
              )}
            </div>

            <div className="mt-5 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan to-volt" initial={false} animate={{ width: `${Math.max(4, progress * 100)}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
            </div>

            <PipelineStepper steps={data.steps} onRetryStep={onRetryStep} className="-mx-2.5 mt-4" />

            {fallbackNotice && (
              <div role="status" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber/30 bg-amber/[0.07] px-3.5 py-2.5 text-[13px] text-amber">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 leading-snug">{fallbackNotice}</span>
                {!data.demo && (
                  <button
                    type="button"
                    data-testid="demo-fallback-btn"
                    onClick={onUseDemo}
                    className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-amber/45 px-2.5 text-[12px] font-semibold text-amber transition-colors hover:bg-amber/15"
                  >
                    Use the sample results instead
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
