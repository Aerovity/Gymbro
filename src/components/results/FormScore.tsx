"use client";
// Form score: huge count-up number in a filling ring, grade letter, coach headline in scoreboard caps.
import { Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Verdict } from "@/lib/types";
import { cn } from "@/lib/utils";
import { C, gradeColor, gradeFor } from "@/components/shared/tokens";
import { useCountUp } from "@/components/shared/useCountUp";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface FormScoreProps {
  /** Final shown score (code score + coach adjustment). Undefined → awaiting state. */
  score?: number;
  /** Code-computed score before the coach adjustment. */
  measured?: number;
  adjustment?: number;
  grade?: "A" | "B" | "C" | "D";
  headline?: string;
  /** Verdict counts for the tally row. */
  counts?: Partial<Record<Verdict, number>>;
  /** Score of the verified AFTER image, if known. */
  afterScore?: number;
  loading?: boolean;
  /** Horizontal layout (ring left, headline right) for full-width placement. */
  wide?: boolean;
  className?: string;
}

const R = 68;
const CIRC = 2 * Math.PI * R;

export function FormScore({ score, measured, adjustment, grade, headline, counts, afterScore, loading, wide, className }: FormScoreProps) {
  const reduce = useReducedMotion();
  const shown = useCountUp(score ?? null, { duration: 1.1, delay: 0.1 });
  const g = grade ?? (score != null ? gradeFor(score) : undefined);
  const liveColor = score == null ? C.dim : gradeColor(gradeFor(shown));
  const has = score != null;
  const adj = adjustment ?? (measured != null && score != null ? score - measured : undefined);

  return (
    <section data-testid="form-score" aria-label={has ? `Form score ${score} of 100, grade ${g}` : "Form score pending"} className={cn("relative overflow-hidden rounded-2xl border border-line bg-surface/85 p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]", className)}>
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full opacity-25 blur-3xl" style={{ background: liveColor }} />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">Form score</span>
        {has && measured != null && (
          <Tooltip>
            <TooltipTrigger delay={80} aria-label="How the score is calculated" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-dim transition-colors hover:bg-surface-3 hover:text-text">
              <Info className="size-4" />
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-mono tabular">
                measured {measured}
                {adj != null && adj !== 0 ? `, coach adjustment ${adj > 0 ? "+" : "−"}${Math.abs(adj)}` : ", no coach adjustment"}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className={cn(wide && "sm:flex sm:items-center sm:gap-6")}>
      <div className="mt-2 flex shrink-0 items-center gap-5">
        <div className="relative size-[148px] shrink-0">
          <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
            <circle cx="80" cy="80" r={R} fill="none" stroke={C.surface3} strokeWidth="10" />
            {Array.from({ length: 40 }, (_, i) => {
              const a = (i / 40) * Math.PI * 2;
              return <line key={i} x1={(8000 + Math.round(7800 * Math.cos(a))) / 100} y1={(8000 + Math.round(7800 * Math.sin(a))) / 100} x2={(8000 + Math.round(7500 * Math.cos(a))) / 100} y2={(8000 + Math.round(7500 * Math.sin(a))) / 100} stroke={C.dim} strokeOpacity="0.35" strokeWidth="1" />;
            })}
            {has && (
              <circle
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={liveColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - Math.max(0, Math.min(100, shown)) / 100)}
                style={{ filter: `drop-shadow(0 0 8px ${liveColor})`, transition: "stroke 300ms" }}
              />
            )}
            {!has && loading && !reduce && (
              <motion.circle cx="80" cy="80" r={R} fill="none" stroke={C.cyan} strokeOpacity="0.6" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${CIRC * 0.18} ${CIRC}`} animate={{ rotate: 360 }} style={{ transformOrigin: "80px 80px" }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-[64px] leading-none tabular" style={{ color: has ? C.text : C.dim }}>
              {has ? Math.round(shown) : "--"}
            </span>
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-dim">/ 100</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-end gap-3">
            <div
              className="flex size-[60px] items-center justify-center rounded-xl border-2 font-display text-[44px] leading-none"
              style={{ borderColor: g ? gradeColor(g) : C.line, color: g ? gradeColor(g) : C.dim, boxShadow: g ? `0 0 24px -6px ${gradeColor(g)}` : undefined }}
              aria-label={g ? `Grade ${g}` : "Grade pending"}
            >
              {g ?? "–"}
            </div>
            <div className="pb-1 font-mono text-[10px] uppercase leading-4 tracking-[0.18em] text-dim">
              Grade
              <br />
              {afterScore != null ? (
                <span className="text-volt">after fix {afterScore}</span>
              ) : (
                <span>{has ? "measured" : loading ? "measuring…" : "awaiting"}</span>
              )}
            </div>
          </div>
          {counts && (
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular">
              {counts.bad ? <span className="text-signal">✕ {counts.bad} out</span> : null}
              {counts.borderline ? <span className="text-amber">! {counts.borderline} close</span> : null}
              {counts.good ? <span className="text-volt">✓ {counts.good} in range</span> : null}
            </div>
          )}
        </div>
      </div>

      <div className={cn("mt-4 min-h-[56px] border-t border-line pt-4", wide && "sm:mt-2 sm:flex-1 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0")}>
        {headline ? (
          <motion.h2
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="font-display text-[clamp(26px,2.4vw,34px)] uppercase leading-[1.02] tracking-wide text-text text-balance"
          >
            {headline}
          </motion.h2>
        ) : (
          <div className="space-y-2" aria-hidden>
            <div className="h-6 w-4/5 animate-pulse rounded bg-surface-3" />
            <div className="h-6 w-1/2 animate-pulse rounded bg-surface-3" />
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
