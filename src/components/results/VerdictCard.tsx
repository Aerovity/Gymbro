"use client";
// The one verdict card: score ring + grade + headline, the coach's spoken summary (streams with a caret),
// the main fault, the top 3 cues as checkable chips, a voice toggle and a compact "next session" drill.
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Dumbbell, Info, RotateCcw, ShieldCheck, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import type { Verdict } from "@/lib/types";
import type { CoachReport } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { C, gradeColor, gradeFor } from "@/components/shared/tokens";
import { Eyebrow } from "@/components/shared/Broadcast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderBadge } from "./ProviderBadge";
import { ScoreRing } from "./ScoreRing";

export interface VerdictCardProps {
  /** Final shown score (code score + coach adjustment). */
  score?: number;
  /** Code-computed score before the coach adjustment. */
  measured?: number;
  grade?: "A" | "B" | "C" | "D";
  /** Coach headline, or a measured fallback. */
  headline?: string;
  counts?: Partial<Record<Verdict, number>>;
  /** Live streamed spoken summary (may be partial). */
  coachText: string;
  coach?: CoachReport;
  /** Coach text is still arriving. */
  streaming?: boolean;
  /** Coach came from static rules (LLM unavailable). */
  fallback?: boolean;
  /** Badge text for where the coaching came from. */
  coachProvider?: string;
  voiceOn?: boolean;
  onToggleVoice?: () => void;
  onRetryCoach?: () => void;
  className?: string;
}

function Dots() {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex items-end gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-cyan" animate={reduce ? undefined : { y: [0, -4, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
      ))}
    </span>
  );
}

const label = "font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim";

export function VerdictCard({ score, measured, grade, headline, counts, coachText, coach, streaming, fallback, coachProvider, voiceOn, onToggleVoice, onRetryCoach, className }: VerdictCardProps) {
  const reduce = useReducedMotion();
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const g = grade ?? (score != null ? gradeFor(score) : undefined);
  const gc = g ? gradeColor(g) : C.dim;
  const adj = measured != null && score != null ? score - measured : undefined;
  const body = coachText || coach?.spoken_summary || "";
  const cues = (coach?.cues ?? []).slice(0, 3);
  const enter = (d: number) => (reduce ? { initial: false as const } : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: d, ease: [0.2, 0.8, 0.2, 1] as const } });

  return (
    <section aria-label="Verdict" className={cn("relative overflow-hidden rounded-3xl border border-line bg-surface/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_30px_60px_-40px_rgb(0_0_0/0.9)]", className)}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full opacity-[0.18] blur-3xl" style={{ background: gc }} />

      {/* Header */}
      <header className="relative flex items-center gap-2 px-5 pt-5 sm:px-7 sm:pt-6">
        <Eyebrow tone="volt">Verdict</Eyebrow>
        {coachProvider && (coach || streaming) && <ProviderBadge provider={coachProvider} size="xs" className="ml-1" />}
        {onToggleVoice && (
          <button
            type="button"
            onClick={onToggleVoice}
            aria-pressed={!!voiceOn}
            aria-label={voiceOn ? "Turn coach voice off" : "Read the coaching aloud"}
            title={voiceOn ? "Voice on" : "Read it to me"}
            className={cn(
              "ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition-colors duration-200",
              voiceOn ? "border-volt/50 bg-volt/10 text-volt" : "border-line bg-surface-2/80 text-dim hover:text-text",
            )}
          >
            {voiceOn ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
            <span className="hidden sm:inline">{voiceOn ? "Voice on" : "Voice"}</span>
          </button>
        )}
      </header>

      {/* Score + headline */}
      <motion.div
        {...enter(0)}
        data-testid="form-score"
        role="group"
        aria-label={score != null ? `Form score ${score} of 100, grade ${g}` : "Form score pending"}
        className="relative flex items-center gap-5 px-5 pt-4 sm:gap-7 sm:px-7 sm:pt-5"
      >
        <ScoreRing score={score} className="size-[100px] sm:size-[124px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-9 items-center justify-center rounded-lg border-2 font-display text-[24px] leading-none"
              style={{ borderColor: gc, color: gc, boxShadow: g ? `0 0 18px -6px ${gc}` : undefined }}
              aria-label={g ? `Grade ${g}` : "Grade pending"}
            >
              {g ?? "–"}
            </span>
            <span className={label}>Grade</span>
            {measured != null && score != null && (
              <Tooltip>
                <TooltipTrigger delay={80} aria-label="How the score is calculated" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-dim transition-colors hover:bg-surface-3 hover:text-text">
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  <span className="font-mono tabular">
                    measured {measured}
                    {adj ? `, coach adjustment ${adj > 0 ? "+" : "−"}${Math.abs(adj)}` : ", no coach adjustment"}
                  </span>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {headline ? (
            <h2 className="mt-2.5 font-display text-[clamp(24px,2.5vw,36px)] uppercase leading-[1.02] tracking-wide text-text text-balance">{headline}</h2>
          ) : (
            <div className="mt-3 space-y-2" aria-hidden>
              <div className="h-6 w-4/5 animate-pulse rounded bg-surface-3" />
              <div className="h-6 w-1/2 animate-pulse rounded bg-surface-3" />
            </div>
          )}
          {counts && (
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular">
              {counts.bad ? <span className="text-signal">✕ {counts.bad} out of range</span> : null}
              {counts.borderline ? <span className="text-amber">! {counts.borderline} close</span> : null}
              {counts.good ? <span className="text-volt">✓ {counts.good} good</span> : null}
            </div>
          )}
        </div>
      </motion.div>

      {/* Coach summary */}
      <motion.div {...enter(0.08)} className="relative px-5 pt-5 sm:px-7 sm:pt-6">
        {fallback && (
          <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-amber">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">Rule-based coaching — the AI coach was unavailable.</span>
            {onRetryCoach && (
              <button type="button" onClick={onRetryCoach} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 font-semibold transition-colors hover:bg-amber/10">
                <RotateCcw className="size-3.5" aria-hidden /> Retry AI
              </button>
            )}
          </div>
        )}
        <div className="border-l-2 border-volt/70 pl-4">
          <p data-testid="coach-text" aria-live="polite" aria-busy={!!streaming} className={cn("text-[16px] leading-relaxed sm:text-[16.5px]", body ? "text-text" : "text-dim")}>
            {body ? (
              <>
                {body}
                {streaming && <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[0.5em] translate-y-[0.18em] animate-tally bg-volt" />}
              </>
            ) : (
              <span className="inline-flex items-center gap-3">
                Coach is reviewing the tape… <Dots />
              </span>
            )}
          </p>
        </div>
      </motion.div>

      {coach && (
        <motion.div {...enter(0.16)} className="relative mt-6 border-t border-line/80">
          {/* Main fault */}
          <div className="px-5 py-5 sm:px-7">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-signal">Main fault</span>
              <span className="ml-auto flex gap-0.5" role="img" aria-label={`severity ${coach.primary_fault.severity} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={cn("h-2.5 w-1.5 rounded-[1px]", n <= coach.primary_fault.severity ? "bg-signal" : "bg-surface-3")} />
                ))}
              </span>
            </div>
            <h3 className="mt-1.5 font-display text-[22px] uppercase leading-tight tracking-wide text-text">{coach.primary_fault.title}</h3>
            <p className="mt-1 text-[14px] leading-snug text-dim">{coach.primary_fault.explanation}</p>
            {coach.secondary_faults.length > 0 && (
              <p className="mt-2 text-[12.5px] leading-snug text-dim">
                <span className="font-semibold text-amber">Also: </span>
                {coach.secondary_faults.map((f) => f.title).join(" · ")}
              </p>
            )}
          </div>

          {/* Cues */}
          <div className="border-t border-line/80 px-5 py-5 sm:px-7">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className={label}>For your next set</span>
              <span className="font-mono text-[10.5px] tabular text-dim">
                {checked.size}/{cues.length}
              </span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {cues.map((c, i) => {
                const on = checked.has(i);
                return (
                  <li key={c}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(i)}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-left text-[14px] font-medium transition-colors duration-200",
                        on ? "border-volt/60 bg-volt/15 text-volt" : "border-line bg-surface-2/80 text-text hover:border-volt/40",
                      )}
                    >
                      <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-volt bg-volt text-bg" : "border-dim/60")}>
                        {on && <Check className="size-3" strokeWidth={3} aria-hidden />}
                      </span>
                      {c}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Drill */}
          <div className="flex items-start gap-3.5 border-t border-line/80 bg-bg/30 px-5 py-4 sm:px-7">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan/10 text-cyan ring-1 ring-cyan/30">
              <Dumbbell className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className={label}>Next session drill</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-display text-[18px] uppercase leading-tight tracking-wide text-text">{coach.drill.name}</span>
                <span className="font-mono text-[12.5px] font-semibold tabular text-volt">{coach.drill.prescription}</span>
              </div>
              <p className="mt-0.5 text-[13px] leading-snug text-dim">{coach.drill.why}</p>
            </div>
          </div>

          {coach.safety_note && (
            <p className="flex items-start gap-2 border-t border-line/80 px-5 py-3 text-[12.5px] leading-snug text-dim sm:px-7">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
              <span>{coach.safety_note}</span>
            </p>
          )}
        </motion.div>
      )}
      {!coach && <div className="h-6" />}
    </section>
  );
}
