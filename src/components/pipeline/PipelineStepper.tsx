"use client";
// Vertical broadcast "rundown" of the 7 pipeline steps with live labels, timings and provider badges.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CornerDownRight, LoaderCircle, Minus, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { StepId, StepState } from "@/lib/store/pipeline";
import { cn } from "@/lib/utils";
import { fmtMs } from "@/components/shared/tokens";
import { ProviderBadge } from "@/components/results/ProviderBadge";

const NUM: Record<StepId, string> = { upload: "01", scan: "02", found: "03", pose: "04", coach: "05", correct: "06", verify: "07" };

function StatusIcon({ s }: { s: StepState["status"] }) {
  const reduce = useReducedMotion();
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 500, damping: 30 };
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {s === "active" ? (
          <motion.span key="a" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} className="flex size-8 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan shadow-[0_0_18px_-2px_var(--color-cyan)]">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          </motion.span>
        ) : s === "done" ? (
          <motion.span key="d" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={spring} className="flex size-8 items-center justify-center rounded-full bg-volt text-bg shadow-[0_0_16px_-4px_var(--color-volt)]">
            <Check className="size-4" strokeWidth={3} aria-hidden />
          </motion.span>
        ) : s === "failed" ? (
          <motion.span key="f" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring} className="flex size-8 items-center justify-center rounded-full bg-signal/15 text-signal ring-1 ring-signal/50">
            <X className="size-4" strokeWidth={3} aria-hidden />
          </motion.span>
        ) : s === "fallback" ? (
          <motion.span key="fb" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring} className="flex size-8 items-center justify-center rounded-full bg-amber/15 text-amber ring-1 ring-amber/50">
            <TriangleAlert className="size-4" strokeWidth={2.5} aria-hidden />
          </motion.span>
        ) : s === "skipped" ? (
          <motion.span key="s" className="flex size-8 items-center justify-center rounded-full border border-dashed border-line text-dim">
            <Minus className="size-3.5" aria-hidden />
          </motion.span>
        ) : (
          <motion.span key="p" className="flex size-8 items-center justify-center rounded-full border border-line bg-surface-2">
            <span className="size-1.5 rounded-full bg-dim/60" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

const STATUS_WORD: Record<StepState["status"], string> = {
  pending: "pending",
  active: "in progress",
  done: "done",
  failed: "failed",
  fallback: "used fallback",
  skipped: "skipped",
};

export interface PipelineStepperProps {
  steps: StepState[];
  className?: string;
  /** Retry handler shown on failed steps. */
  onRetryStep?: (id: StepId) => void;
}

export function PipelineStepper({ steps, className, onRetryStep }: PipelineStepperProps) {
  const done = steps.filter((s) => s.status === "done" || s.status === "fallback").length;
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">Rundown</span>
        <span className="font-mono text-[11px] tabular text-dim">
          <span className="text-text">{done}</span>/{steps.length}
        </span>
      </div>
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-surface-3">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan to-volt" initial={false} animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
      <ol data-testid="stepper" className="relative flex flex-col" aria-label="Analysis progress">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const active = s.status === "active";
          return (
            <li
              key={s.id}
              data-testid={`step-${s.id}`}
              data-status={s.status}
              aria-current={active ? "step" : undefined}
              className={cn(
                "relative flex gap-3 rounded-xl px-2 py-2 transition-colors duration-200",
                active && "bg-cyan/[0.06] shadow-[inset_2px_0_0_var(--color-cyan)]",
              )}
            >
              {!last && (
                <span aria-hidden className={cn("absolute left-[23px] top-11 bottom-[-6px] w-px", s.status === "done" || s.status === "fallback" ? "bg-volt/40" : "bg-line")} />
              )}
              <StatusIcon s={s.status} />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-dim/70 tabular">{NUM[s.id]}</span>
                  <span className={cn("line-clamp-2 min-w-0 text-[13.5px] font-medium leading-5", s.status === "pending" || s.status === "skipped" ? "text-dim" : "text-text", s.status === "failed" && "text-signal")}>
                    {s.label}
                  </span>
                  <span className="sr-only">— {STATUS_WORD[s.status]}</span>
                  {s.ms != null && s.status !== "active" && <span className="ml-auto shrink-0 font-mono text-[11px] tabular text-dim">{fmtMs(s.ms)}</span>}
                </div>
                {(s.provider || s.note) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {s.provider && <ProviderBadge provider={s.provider} size="xs" />}
                    {s.note && (
                      <span className={cn("inline-flex items-center gap-1 text-[11.5px] leading-4", s.status === "failed" ? "text-signal/90" : s.status === "fallback" ? "text-amber" : "text-dim")}>
                        <CornerDownRight className="size-3" aria-hidden />
                        {s.note}
                      </span>
                    )}
                  </div>
                )}
                {s.status === "failed" && onRetryStep && (
                  <button type="button" onClick={() => onRetryStep(s.id)} className="mt-2 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-signal/40 bg-signal/10 px-3 text-xs font-semibold text-signal transition-colors hover:bg-signal/20">
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

/** Compact progress chip for the mobile bottom bar. */
export function StepperCompact({ steps }: { steps: StepState[] }) {
  const idx = steps.findIndex((s) => s.status === "active");
  const cur = idx >= 0 ? steps[idx] : undefined;
  const done = steps.filter((s) => s.status === "done" || s.status === "fallback").length;
  return (
    <div className="flex items-center gap-3">
      <LoaderCircle className="size-4 shrink-0 animate-spin text-cyan" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{cur?.label ?? "Working…"}</div>
        <div className="mt-1.5 flex gap-1">
          {steps.map((s) => (
            <span key={s.id} className={cn("h-1 flex-1 rounded-full", s.status === "done" ? "bg-volt" : s.status === "fallback" ? "bg-amber" : s.status === "failed" ? "bg-signal" : s.status === "active" ? "bg-cyan animate-tally" : "bg-surface-3")} />
          ))}
        </div>
      </div>
      <span className="font-mono text-xs tabular text-dim">
        {done + (cur ? 1 : 0)}/{steps.length}
      </span>
    </div>
  );
}
