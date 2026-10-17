"use client";
// Broadcast lower-third: "FOUND BAD REP AT 0:07" with a clip-path wipe and a count-up timestamp.
import { motion, useReducedMotion } from "motion/react";
import type { ChosenMoment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtTime, humanize } from "@/components/shared/tokens";
import { useCountUp } from "@/components/shared/useCountUp";

export interface FoundBannerProps {
  moment: ChosenMoment;
  /** "overlay" sits over media; "bar" is the compact inline header version. */
  variant?: "overlay" | "bar";
  providerLabel?: string;
  /** Overlay size: "sm" for narrow players. */
  size?: "md" | "sm";
  className?: string;
  testId?: string;
}

export function FoundBanner({ moment, variant = "overlay", providerLabel = "NVIDIA video AI", size = "md", className, testId }: FoundBannerProps) {
  const sm = size === "sm";
  const reduce = useReducedMotion();
  const t = useCountUp(moment.t, { duration: 0.6, delay: reduce ? 0 : 0.35 });
  const ev = moment.event;
  const rep = ev?.rep_index != null ? `Rep ${ev.rep_index}` : undefined;
  const wipe = reduce ? {} : { initial: { clipPath: "inset(0 100% 0 0)" }, animate: { clipPath: "inset(0 0% 0 0)" }, transition: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] as const } };

  if (variant === "bar") {
    return (
      <motion.div data-testid={testId} {...wipe} className={cn("flex min-w-0 items-stretch overflow-hidden rounded-lg", className)} role="status">
        <span className="flex items-center bg-signal px-2.5 font-display text-[15px] uppercase leading-none tracking-wide text-white">Found bad rep at</span>
        <span className="flex items-center bg-text px-2.5 font-mono text-[15px] font-bold tabular text-bg">{fmtTime(t)}</span>
        {ev?.issue && <span className="flex min-w-0 items-center truncate bg-surface-3 px-2.5 text-[13px] font-medium text-text">{humanize(ev.issue)}</span>}
      </motion.div>
    );
  }

  return (
    <div data-testid={testId} role="status" aria-live="polite" className={cn("pointer-events-none w-full max-w-[min(100%,560px)]", className)}>
      <motion.div {...wipe} className="flex flex-col items-start">
        <div className="flex items-center gap-2 rounded-t-md bg-nvidia px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-bg">
          <span className="size-1.5 rounded-full bg-bg" />
          {providerLabel}
          {rep && <span className="opacity-70">· {rep}</span>}
        </div>
        <div className="flex w-full items-stretch shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]">
          <div className="w-1.5 shrink-0 bg-signal" />
          <div className={cn("flex min-w-0 flex-1 items-center gap-3 bg-bg/90 backdrop-blur-md", sm ? "justify-between px-3 py-2" : "px-3 py-2.5 sm:px-4")}>
            <span className={cn("whitespace-nowrap font-display uppercase leading-none tracking-wide text-text", sm ? "text-[clamp(16px,1.6vw,21px)]" : "text-[clamp(18px,2.6vw,30px)]")}>
              Found bad rep at
            </span>
            <span className={cn("rounded-md bg-signal px-2 py-1 font-mono font-bold leading-none tabular text-white shadow-[var(--shadow-glow-signal)]", sm ? "text-[clamp(15px,1.5vw,20px)]" : "text-[clamp(17px,2.4vw,28px)]")}>
              {fmtTime(t)}
            </span>
          </div>
        </div>
        {ev && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.6, duration: 0.25 }}
            className="flex max-w-full items-center gap-2 bg-surface-2/95 px-3 py-1.5 text-[12.5px] text-text backdrop-blur-md"
          >
            <span className="truncate font-semibold uppercase tracking-wide text-signal">{humanize(ev.issue)}</span>
            <span className="hidden text-dim sm:inline">·</span>
            <span className="hidden truncate text-dim sm:inline">{ev.body_part}</span>
            <span className="ml-1 shrink-0 whitespace-nowrap font-mono text-[11px] tabular text-dim">{Math.round(ev.confidence * 100)}% conf</span>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
