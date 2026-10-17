"use client";
// The analyze page view. Two clearly separate modes with a smooth crossfade:
//  A) ANALYZING — the user's own clip + a calm 5-step checklist (data-testid="analyzing-screen")
//  B) RESULTS   — media (Photo | 3D), one verdict card, what we measured, "Under the hood" (data-testid="results-screen")
// plus a centred error state. Props only — no store access.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";
import type { ExerciseId, Pt, Stage } from "@/lib/types";
import type { PipelineData, StepId } from "@/lib/store/pipeline";
import { Wordmark } from "@/components/shared/Broadcast";
import { isScanFallback, scanProviderLabel } from "@/components/shared/exercise";
import { AgentTrace } from "@/components/results/AgentTrace";
import { ErrorState } from "@/components/results/ErrorState";
import { AnalyzingScreen } from "./AnalyzingScreen";
import { ResultsScreen } from "./ResultsScreen";

export interface AnalyzeViewProps {
  data: PipelineData;
  onToggleSkeleton: () => void;
  onToggleVoice: () => void;
  onRetryStep: (step: StepId) => void;
  onUseDemo: () => void;
  /** Optional, on-demand AI photo of the fix (GPT Image edit → re-measure). */
  onGenerateAiPhoto: () => void;
  /** Re-analyse the clip as another exercise (results header "Change" menu). */
  onChangeExercise: (ex: ExerciseId) => void;
  onPickOtherMoment: () => void;
  onStartOver: () => void;
  onSeek: (t: number) => void;
  onDownload: () => void;
  onShare: () => void;
  /** Target ("ghost") skeleton in before-image pixel space; computed locally when omitted. */
  ghostPoints?: Pt[];
  /** Extra model IDs for the agent-trace sheet. */
  models?: Record<string, string>;
}

type Mode = "analyzing" | "results" | "error";

/** AI-photo stages never send the user back to the analyzing screen. */
const modeFor = (stage: Stage): Mode => (stage === "error" ? "error" : stage === "done" || stage === "correcting" || stage === "verifying" ? "results" : "analyzing");

const STEP_FOR_STAGE: Partial<Record<Stage, StepId>> = {
  probing: "upload",
  sampling: "upload",
  scanning: "scan",
  picking: "found",
  refining: "found",
  posing: "pose",
  coaching: "coach",
};

function fallbackNoticeFor(data: PipelineData): string | null {
  if (data.demo) return null;
  const p = data.scan?.provider;
  const scanStep = data.steps.find((s) => s.id === "scan");
  if (p === "pose-only") return "The video model was unavailable, so we scanned your set on-device with pose tracking.";
  if (p === "gpt-fallback") return "The NVIDIA video model was unavailable — GPT vision scanned your set instead.";
  if (!p && scanStep?.status === "fallback") return "The video model was unavailable — scanning your set on-device instead.";
  return null;
}

export function AnalyzeView(props: AnalyzeViewProps) {
  const { data, onRetryStep, onUseDemo, onPickOtherMoment, onStartOver, models } = props;
  const reduce = useReducedMotion();
  const [traceOpen, setTraceOpen] = useState(false);
  const mode = modeFor(data.stage);

  const ex: ExerciseId | undefined = data.resolvedExercise ?? data.detected?.exercise ?? (data.exercise !== "auto" ? data.exercise : undefined);
  const providerLabel = data.demo ? "NVIDIA video AI · cached" : scanProviderLabel(data.scan?.provider);
  const fallbackNotice = isScanFallback(data.scan?.provider) || data.steps.some((s) => s.id === "scan" && s.status === "fallback") ? fallbackNoticeFor(data) : null;
  const retryStep = (STEP_FOR_STAGE[data.error?.stage ?? "idle"] ?? data.steps.find((s) => s.status === "failed")?.id) as StepId | undefined;

  // Each mode starts at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [mode]);

  const fade = reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.2, 0.8, 0.2, 1] as const } }, exit: { opacity: 0, y: -6, transition: { duration: 0.22 } } };

  return (
    <div className="flex w-full flex-1 flex-col" data-stage={data.stage}>
      <AnimatePresence mode="wait" initial={false}>
        {mode === "analyzing" && (
          <motion.div key="analyzing" {...fade} className="flex w-full flex-1 flex-col">
            <AnalyzingScreen data={data} exercise={ex} providerLabel={providerLabel} fallbackNotice={fallbackNotice} onUseDemo={onUseDemo} onStartOver={onStartOver} onRetryStep={onRetryStep} />
          </motion.div>
        )}

        {mode === "results" && (
          <motion.div key={`results-${data.startedAt ?? 0}`} {...fade} className="w-full">
            <ResultsScreen
              data={data}
              exercise={ex}
              providerLabel={providerLabel}
              fallbackNotice={fallbackNotice}
              ghostPoints={props.ghostPoints}
              onToggleSkeleton={props.onToggleSkeleton}
              onToggleVoice={props.onToggleVoice}
              onRetryStep={onRetryStep}
              onUseDemo={onUseDemo}
              onGenerateAiPhoto={props.onGenerateAiPhoto}
              onChangeExercise={props.onChangeExercise}
              onPickOtherMoment={onPickOtherMoment}
              onStartOver={onStartOver}
              onSeek={props.onSeek}
              onDownload={props.onDownload}
              onShare={props.onShare}
              onOpenTrace={() => setTraceOpen(true)}
            />
          </motion.div>
        )}

        {mode === "error" && (
          <motion.div key="error" {...fade} className="mx-auto flex min-h-[100svh] w-full max-w-[1240px] flex-col px-4 sm:px-6">
            <header className="flex h-[68px] shrink-0 items-center gap-3">
              <Link href="/" className="rounded-lg" aria-label="Gym Bro home">
                <Wordmark />
              </Link>
              <button type="button" onClick={onStartOver} className="ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-3.5 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3">
                <RotateCcw className="size-4" aria-hidden />
                New clip
              </button>
            </header>
            <main className="flex flex-1 items-center justify-center pb-16">
              <div className="w-full max-w-[560px] rounded-3xl border border-line bg-surface/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_30px_60px_-30px_rgb(0_0_0/0.9)]">
                <ErrorState
                  error={data.error ?? { code: "unknown", message: "Unknown error" }}
                  onUseDemo={data.demo ? undefined : onUseDemo}
                  onRetry={retryStep ? () => onRetryStep(retryStep) : undefined}
                  onPickOtherMoment={onPickOtherMoment}
                  onStartOver={onStartOver}
                />
                {data.trace.length > 0 && (
                  <div className="border-t border-line px-6 py-3 text-center">
                    <button type="button" data-testid="trace-btn" onClick={() => setTraceOpen(true)} className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] text-dim transition-colors hover:text-text">
                      See what happened · agent trace
                    </button>
                  </div>
                )}
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>

      <AgentTrace open={traceOpen} onOpenChange={setTraceOpen} trace={data.trace} scan={data.scan} moment={data.moment} models={models} />
    </div>
  );
}
