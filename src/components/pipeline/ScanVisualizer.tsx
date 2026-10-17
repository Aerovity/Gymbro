"use client";
// Filmstrip of sampled scan frames streaming in, with a scanning laser during the Cosmos pass
// and tinted event windows once the video model has answered.
import { motion, useReducedMotion } from "motion/react";
import type { ScanEvent, SampledFrame, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { C, severityColor } from "@/components/shared/tokens";

export interface ScanVisualizerProps {
  frames: SampledFrame[];
  stage: Stage;
  duration: number;
  events?: ScanEvent[];
  chosenT?: number;
  /** Number of slots to reserve while frames are streaming in. */
  expected?: number;
  className?: string;
}

export function ScanVisualizer({ frames, stage, duration, events = [], chosenT, expected = 24, className }: ScanVisualizerProps) {
  const reduce = useReducedMotion();
  const sampling = stage === "probing" || stage === "sampling";
  const scanning = stage === "scanning";
  const slots = Math.max(frames.length, sampling || frames.length === 0 ? expected : frames.length);
  const dur = duration > 0 ? duration : 1;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`;

  return (
    <div className={cn("relative h-[76px] overflow-hidden rounded-lg border border-line bg-surface-2 sm:h-[92px]", className)} aria-label={`Filmstrip, ${frames.length} frames sampled`} role="img">
      <div className="flex h-full gap-[2px]">
        {Array.from({ length: slots }, (_, i) => {
          const f = frames[i];
          return (
            <div key={i} className="relative h-full min-w-0 flex-1 overflow-hidden bg-surface-3">
              {f ? (
                <motion.img
                  src={f.dataUrl}
                  alt=""
                  draggable={false}
                  className={cn("h-full w-full object-cover", scanning ? "brightness-[0.85]" : "brightness-[0.7] saturate-[0.85]")}
                  initial={reduce ? false : { opacity: 0, scale: 1.15 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                />
              ) : (
                <div className={cn("h-full w-full", sampling && "shimmer")} />
              )}
            </div>
          );
        })}
      </div>

      {/* Event windows */}
      {!scanning &&
        events.map((e, i) => {
          const chosen = chosenT != null && chosenT >= e.t_start - 0.6 && chosenT <= e.t_end + 0.6;
          const col = chosen ? C.signal : severityColor(e.severity);
          return (
            <motion.div
              key={i}
              aria-hidden
              className="pointer-events-none absolute inset-y-0"
              style={{ left: pct(e.t_start), width: `calc(${pct(e.t_end - e.t_start)} + 2px)`, background: `${col}${chosen ? "33" : "1f"}`, boxShadow: `inset 0 0 0 2px ${col}${chosen ? "" : "aa"}` }}
              initial={reduce ? false : { opacity: 0, scaleY: 0.6 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ delay: 0.1 * i, type: "spring", stiffness: 400, damping: 28 }}
            />
          );
        })}

      {/* Scanning laser */}
      {scanning && (
        <div aria-hidden className="pointer-events-none absolute inset-0 animate-scan">
          <div className="absolute inset-y-0 left-[-140px] w-[140px] bg-gradient-to-r from-transparent via-cyan/10 to-cyan/35" />
          <div className="absolute inset-y-[-4px] left-0 w-[2px] bg-cyan shadow-[0_0_14px_3px_var(--color-cyan)]" />
        </div>
      )}
      {scanning && <div aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgb(46_230_255/0.05)_0px,rgb(46_230_255/0.05)_1px,transparent_1px,transparent_4px)]" />}
    </div>
  );
}
