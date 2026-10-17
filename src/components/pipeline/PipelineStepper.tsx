"use client";
// The 5 analysis steps as a calm checklist: status icon, friendly label, a live sub-line,
// a tiny provider badge on the scan step only, and the step time right-aligned in muted mono.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, LoaderCircle, Minus, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { StepId, StepState } from "@/lib/store/pipeline";
import { cn } from "@/lib/utils";
import { fmtMs } from "@/components/shared/tokens";
import { ProviderBadge } from "@/components/results/ProviderBadge";

/** Friendly, fixed titles (the live label from the pipeline becomes the sub-line). */
export const STEP_TITLE: Record<string, string> = {
  upload: "Reading your video",
  scan: "Watching your set",
  found: "Finding the rep to fix",
  pose: "Measuring your joints",
  coach: "Writing your coaching",
};

/** Sub-line while a step is running and the pipeline hasn't sent a more specific label. */
const ACTIVE_HINT: Record<string, string> = {
  upload: "Checking length, size and orientation",
  scan: "NVIDIA video AI is watching every rep",
  found: "Picking the clearest rep that broke down",
  pose: "33 body points on the exact frame",
  coach: "Turning your angles into cues",
};

const STATUS_WORD: Record<StepState["status"], string> = {
  pending: "waiting",
  active: "in progress",
  done: "done",
  failed: "failed",
  fallback: "done with a fallback",
  skipped: "skipped",
};

export const isStepFinished = (s: StepState) => s.status === "done" || s.status === "fallback" || s.status === "skipped";

/** 0–1 progress across the steps (a running step counts as half). */
export function stepProgress(steps: StepState[]): number {
  if (!steps.length) return 0;
  const done = steps.filter(isStepFinished).length;
  const active = steps.some((s) => s.status === "active") ? 0.5 : 0;
  return Math.min(1, (done + active) / steps.length);
}

function StatusIcon({ s, compact }: { s: StepState["status"]; compact?: boolean }) {
  const reduce = useReducedMotion();
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 500, damping: 32 };
  const box = compact ? "size-6" : "size-8";
  const icon = compact ? "size-3" : "size-4";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", box)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {s === "active" ? (
          <motion.span key="a" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} className={cn("flex items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan shadow-[0_0_18px_-4px_var(--color-cyan)]", box)}>
            <LoaderCircle className={cn(icon, "animate-spin")} aria-hidden />
          </motion.span>
        ) : s === "done" ? (
          <motion.span key="d" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={spring} className={cn("flex items-center justify-center rounded-full bg-volt text-bg", box)}>
            <Check className={icon} strokeWidth={3} aria-hidden />
          </motion.span>
        ) : s === "failed" ? (
          <motion.span key="f" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring} className={cn("flex items-center justify-center rounded-full bg-signal/15 text-signal ring-1 ring-signal/50", box)}>
            <X className={icon} strokeWidth={3} aria-hidden />
          </motion.span>
        ) : s === "fallback" ? (
          <motion.span key="fb" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring} className={cn("flex items-center justify-center rounded-full bg-amber/15 text-amber ring-1 ring-amber/50", box)}>
            <Check className={icon} strokeWidth={3} aria-hidden />
          </motion.span>
        ) : s === "skipped" ? (
          <motion.span key="s" className={cn("flex items-center justify-center rounded-full border border-dashed border-line text-dim", box)}>
            <Minus className={icon} aria-hidden />
          </motion.span>
        ) : (
          <motion.span key="p" className={cn("flex items-center justify-center rounded-full border border-line bg-surface-2/60", box)}>
            <span className="size-1.5 rounded-full bg-dim/50" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export interface PipelineStepperProps {
  steps: StepState[];
  className?: string;
  /** Retry handler shown on failed steps. */
  onRetryStep?: (id: StepId) => void;
  /** Dense rows for the "Under the hood" summary. */
  compact?: boolean;
}

export function PipelineStepper({ steps, className, onRetryStep, compact }: PipelineStepperProps) {
  const activeIdx = steps.findIndex((s) => s.status === "active");
  const active = activeIdx >= 0 ? steps[activeIdx] : undefined;
  return (
    <div className={cn("flex flex-col", className)}>
      {!compact && (
        <p className="sr-only" aria-live="polite">
          {active ? `Step ${activeIdx + 1} of ${steps.length}: ${STEP_TITLE[active.id] ?? active.label}` : ""}
        </p>
      )}
      <ol data-testid="stepper" className="relative flex flex-col" aria-label="Analysis steps">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const isActive = s.status === "active";
          const finished = isStepFinished(s);
          const title = STEP_TITLE[s.id] ?? s.label;
          const custom = s.label && s.label !== title ? s.label : undefined;
          const sub = isActive ? (custom ?? ACTIVE_HINT[s.id]) : s.status === "pending" ? undefined : custom;
          const showProvider = s.id === "scan" && !!s.provider && s.status !== "pending";
          return (
            <li
              key={s.id}
              data-testid={`step-${s.id}`}
              data-status={s.status}
              aria-current={isActive ? "step" : undefined}
              className={cn("relative flex rounded-xl transition-colors duration-300", compact ? "gap-3 py-1.5" : "gap-3.5 px-2.5 py-2.5", !compact && isActive && "bg-white/[0.035]")}
            >
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute w-px transition-colors duration-500",
                    compact ? "bottom-[-6px] left-[11.5px] top-8" : "bottom-[-10px] left-[25.5px] top-[46px]",
                    finished ? "bg-volt/35" : "bg-line",
                  )}
                />
              )}
              <StatusIcon s={s.status} compact={compact} />
              <div className={cn("min-w-0 flex-1", compact ? "pt-[3px]" : "pt-[5px]")}>
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap font-medium leading-5",
                      compact ? "text-[13px]" : "text-[15px]",
                      s.status === "pending" || s.status === "skipped" ? "text-dim" : "text-text",
                      s.status === "failed" && "text-signal",
                    )}
                  >
                    {title}
                  </span>
                  <span className="sr-only">— {STATUS_WORD[s.status]}</span>
                  {showProvider && <ProviderBadge provider={s.provider!} size="xs" className="hidden min-w-0 translate-y-[-1px] sm:inline-flex" />}
                  {s.ms != null && s.status !== "active" && s.status !== "pending" && (
                    <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] tabular text-dim/80">{fmtMs(s.ms)}</span>
                  )}
                </div>
                <AnimatePresence initial={false} mode="wait">
                  {sub && (
                    <motion.p
                      key={sub}
                      initial={{ opacity: 0, y: -2 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className={cn("mt-0.5 truncate leading-5", compact ? "text-[12px]" : "text-[13px]", isActive ? "text-cyan/90" : "text-dim")}
                    >
                      {sub}
                    </motion.p>
                  )}
                </AnimatePresence>
                {s.note && (
                  <p className={cn("mt-0.5 flex items-center gap-1 text-[12px] leading-4", s.status === "failed" ? "text-signal/90" : s.status === "fallback" ? "text-amber" : "text-dim")}>
                    {s.status === "fallback" && <TriangleAlert className="size-3 shrink-0" aria-hidden />}
                    <span className="truncate">{s.note}</span>
                  </p>
                )}
                {s.status === "failed" && onRetryStep && (
                  <button
                    type="button"
                    onClick={() => onRetryStep(s.id)}
                    className="mt-2 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-signal/40 bg-signal/10 px-3 text-xs font-semibold text-signal transition-colors hover:bg-signal/20"
                  >
                    <RotateCcw className="size-3.5" aria-hidden /> Retry step
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
