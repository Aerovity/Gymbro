"use client";
// Coach panel: streamed spoken summary (caret), primary fault, checkable cue chips, drill, safety note, voice toggle.
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Dumbbell, RotateCcw, ShieldCheck, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import type { CoachReport } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "./ProviderBadge";

export interface CoachPanelProps {
  /** Live streamed spoken_summary (may be partial). */
  text: string;
  coach?: CoachReport;
  /** True while the coach is streaming. */
  streaming?: boolean;
  /** True when the coach has not started yet but will soon (shows "reviewing the tape…"). */
  waiting?: boolean;
  /** Coach came from static rules (LLM failed). */
  fallback?: boolean;
  voiceOn?: boolean;
  onToggleVoice?: () => void;
  onRetry?: () => void;
  /** Badge text for where the coaching came from (defaults to OpenAI GPT / rules). */
  providerLabel?: string;
  className?: string;
}

function Dots() {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex items-end gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-cyan" animate={reduce ? undefined : { y: [0, -5, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
      ))}
    </span>
  );
}

export function CoachPanel({ text, coach, streaming, waiting, fallback, voiceOn, onToggleVoice, onRetry, providerLabel, className }: CoachPanelProps) {
  const reduce = useReducedMotion();
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const body = text || coach?.spoken_summary || "";
  const idle = !body && !waiting && !streaming;

  return (
    <section aria-label="Coach" className={cn("relative flex flex-col rounded-2xl border border-line bg-surface/85 p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]", className)}>
      <header className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">Coach</span>
        {(coach || streaming) && <ProviderBadge provider={providerLabel ?? (fallback ? "rules" : "OpenAI GPT")} size="xs" />}
        {onToggleVoice && (
          <button
            type="button"
            onClick={onToggleVoice}
            aria-pressed={!!voiceOn}
            aria-label={voiceOn ? "Turn coach voice off" : "Turn coach voice on"}
            className={cn(
              "ml-auto inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border transition-colors duration-200",
              voiceOn ? "border-volt/50 bg-volt/10 text-volt" : "border-line bg-surface-2 text-dim hover:text-text",
            )}
          >
            {voiceOn ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
          </button>
        )}
      </header>

      {fallback && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2.5 text-[13px] text-amber">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            <b className="font-semibold">Rule-based coach.</b> <span className="text-amber/85">The AI coach was unavailable, so these cues come straight from the measured rules.</span>
          </span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-amber/50 px-2.5 text-xs font-semibold transition-colors hover:bg-amber/15">
              <RotateCcw className="size-3.5" aria-hidden /> Retry AI
            </button>
          )}
        </div>
      )}

      <div className="mt-3 border-l-2 border-volt/70 pl-4">
        <p data-testid="coach-text" aria-live="polite" aria-busy={!!streaming} className={cn("min-h-[3lh] text-[16px] leading-relaxed", idle ? "text-dim" : "text-text")}>
          {body ? (
            <>
              {body}
              {streaming && <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[0.5em] translate-y-[0.18em] animate-tally bg-volt" />}
            </>
          ) : waiting || streaming ? (
            <span className="inline-flex items-center gap-3 text-dim">
              Coach is reviewing the tape… <Dots />
            </span>
          ) : (
            <span className="text-dim">The coach goes live as soon as your joints are measured.</span>
          )}
        </p>
      </div>

      {coach && (
        <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mt-5 flex flex-col gap-4">
          <div className="rounded-xl border border-signal/30 bg-signal/[0.06] p-3.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal">Primary fault</span>
              <span className="ml-auto flex gap-0.5" role="img" aria-label={`severity ${coach.primary_fault.severity} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={cn("h-2.5 w-1.5 rounded-[1px]", n <= coach.primary_fault.severity ? "bg-signal" : "bg-surface-3")} />
                ))}
              </span>
            </div>
            <h3 className="mt-1.5 font-display text-xl uppercase tracking-wide text-text">{coach.primary_fault.title}</h3>
            <p className="mt-1 text-[13.5px] leading-snug text-dim">{coach.primary_fault.explanation}</p>
            {coach.secondary_faults.length > 0 && (
              <ul className="mt-2.5 space-y-1 border-t border-signal/15 pt-2.5">
                {coach.secondary_faults.map((f) => (
                  <li key={f.title} className="text-[12.5px] leading-snug text-dim">
                    <span className="font-semibold text-amber">! {f.title}</span> — {f.explanation}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">Cues for your next set</span>
              <span className="font-mono text-[10px] tabular text-dim">
                {checked.size}/{coach.cues.length}
              </span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {coach.cues.map((c, i) => {
                const on = checked.has(i);
                return (
                  <li key={c}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(i)}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-left text-[13.5px] font-medium transition-colors duration-200",
                        on ? "border-volt/60 bg-volt/15 text-volt" : "border-line bg-surface-2 text-text hover:border-volt/40",
                      )}
                    >
                      <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full border", on ? "border-volt bg-volt text-bg" : "border-dim/60")}>
                        {on && <Check className="size-3" strokeWidth={3} aria-hidden />}
                      </span>
                      {c}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex gap-3.5 rounded-xl border border-line bg-surface-2/70 p-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-cyan/10 text-cyan ring-1 ring-cyan/30">
              <Dumbbell className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">Drill</div>
              <div className="mt-0.5 font-display text-lg uppercase tracking-wide text-text">{coach.drill.name}</div>
              <div className="font-mono text-[13px] font-semibold tabular text-volt">{coach.drill.prescription}</div>
              <p className="mt-1 text-[13px] leading-snug text-dim">{coach.drill.why}</p>
            </div>
          </div>

          {coach.safety_note && (
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-dim">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
              <span>
                <span className="font-semibold text-amber">Safety · </span>
                {coach.safety_note}
              </span>
            </p>
          )}
        </motion.div>
      )}
    </section>
  );
}
