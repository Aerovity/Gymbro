"use client";
// Time ruler with Cosmos event markers (severity colour, tooltips); the chosen moment pulses; click → onSeek.
import { motion, useReducedMotion } from "motion/react";
import type { ChosenMoment, ScanEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { C, fmtTime, humanize, severityColor } from "@/components/shared/tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface VideoTimelineProps {
  duration: number;
  events: ScanEvent[];
  chosen?: ChosenMoment;
  currentTime?: number;
  onSeek: (t: number) => void;
  className?: string;
}

function isChosen(e: ScanEvent, m?: ChosenMoment) {
  if (!m) return false;
  if (m.event) return m.event.t_peak === e.t_peak && m.event.issue === e.issue;
  return m.t >= e.t_start - 0.6 && m.t <= e.t_end + 0.6;
}

export function VideoTimeline({ duration, events, chosen, currentTime, onSeek, className }: VideoTimelineProps) {
  const reduce = useReducedMotion();
  const dur = duration > 0 ? duration : 1;
  const pct = (t: number) => Math.min(100, Math.max(0, (t / dur) * 100));
  const step = dur <= 12 ? 1 : dur <= 30 ? 1 : 5;
  const labelEvery = dur <= 12 ? 2 : dur <= 30 ? 3 : 10;
  const ticks = Array.from({ length: Math.floor(dur / step) + 1 }, (_, i) => i * step);
  const chosenIdx = events.findIndex((e) => isChosen(e, chosen));

  return (
    <div className={cn("relative select-none", className)}>
      <div className="relative h-14">
        {/* ruler */}
        <div className="absolute inset-x-0 top-[34px] h-px bg-line" />
        {ticks.map((t) => {
          const major = t % labelEvery === 0;
          return (
            <div key={t} className="absolute top-[34px]" style={{ left: `${pct(t)}%` }}>
              <div className={cn("w-px -translate-x-1/2", major ? "h-2.5 bg-dim/60" : "h-1.5 bg-line")} />
              {major && <div className="mt-0.5 -translate-x-1/2 font-mono text-[10px] tabular text-dim">{fmtTime(t)}</div>}
            </div>
          );
        })}

        {events.length === 0 && (
          <div className="absolute inset-x-0 top-[8px] text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim/70">Video-model markers land here</div>
        )}

        {/* event windows on the ruler */}
        {events.map((e, i) => (
          <div
            key={`w${i}`}
            aria-hidden
            className="absolute top-[31px] h-[7px] rounded-full"
            style={{ left: `${pct(e.t_start)}%`, width: `${Math.max(0.8, pct(e.t_end) - pct(e.t_start))}%`, background: isChosen(e, chosen) ? C.signal : severityColor(e.severity), opacity: isChosen(e, chosen) ? 0.9 : 0.45 }}
          />
        ))}

        {/* refinement hint */}
        {chosen?.refinedFrom != null && Math.abs(chosen.refinedFrom - chosen.t) > 0.05 && (
          <div aria-hidden className="absolute top-[26px] h-px border-t border-dashed border-cyan/70" style={{ left: `${Math.min(pct(chosen.refinedFrom), pct(chosen.t))}%`, width: `${Math.abs(pct(chosen.refinedFrom) - pct(chosen.t))}%` }} />
        )}

        {/* playhead */}
        {currentTime != null && (
          <div aria-hidden className="absolute top-1 bottom-3 w-[2px] -translate-x-1/2 rounded bg-text/80" style={{ left: `${pct(currentTime)}%` }} />
        )}

        {/* markers */}
        {events.map((e, i) => {
          const sel = i === chosenIdx;
          const col = sel ? C.signal : severityColor(e.severity);
          return (
            <Tooltip key={`m${i}`}>
              <TooltipTrigger
                delay={80}
                data-testid="timeline-marker"
                data-chosen={sel ? "true" : "false"}
                aria-label={`${humanize(e.issue)} at ${fmtTime(e.t_peak)}, severity ${e.severity} of 5${sel ? ", chosen moment" : ""}`}
                onClick={() => onSeek(sel && chosen ? chosen.t : e.t_peak)}
                className="group absolute top-0 flex size-11 -translate-x-1/2 cursor-pointer items-start justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-volt"
                style={{ left: `${pct(sel && chosen ? chosen.t : e.t_peak)}%` }}
              >
                <motion.span
                  className="relative mt-[7px] flex flex-col items-center"
                  initial={reduce ? false : { y: -16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 520, damping: 22, delay: reduce ? 0 : 0.12 * i }}
                >
                  {sel && !reduce && (
                    <motion.span
                      aria-hidden
                      className="absolute top-[-3px] size-[22px] rounded-full"
                      style={{ border: `2px solid ${col}` }}
                      animate={{ scale: [1, 1.8], opacity: [0.9, 0] }}
                      transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
                    />
                  )}
                  <span
                    className="block size-4 rotate-45 rounded-[3px] border-2 border-bg transition-transform duration-150 group-hover:scale-125"
                    style={{ background: col, boxShadow: `0 0 ${sel ? 16 : 8}px ${col}` }}
                  />
                  <span className="mt-[3px] h-[13px] w-[2px]" style={{ background: col }} />
                </motion.span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] flex-col items-start gap-1">
                <div className="flex w-full items-center gap-2">
                  <span className="font-semibold uppercase tracking-wide" style={{ color: col }}>
                    {humanize(e.issue)}
                  </span>
                  <span className="ml-auto font-mono tabular text-dim">{fmtTime(e.t_peak, true)}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
                  <span className="flex gap-0.5" aria-label={`severity ${e.severity} of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} className="h-2 w-1.5 rounded-[1px]" style={{ background: n <= e.severity ? col : C.line }} />
                    ))}
                  </span>
                  SEV {e.severity}/5 · {Math.round(e.confidence * 100)}% CONF{e.rep_index != null ? ` · REP ${e.rep_index}` : ""}
                </div>
                <p className="text-[12px] leading-snug text-text/90">{e.description}</p>
                {sel && chosen?.refinedFrom != null && (
                  <p className="font-mono text-[10.5px] text-cyan">
                    refined {fmtTime(chosen.refinedFrom, true)} → {fmtTime(chosen.t, true)} by pose
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
