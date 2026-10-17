"use client";
// Count-up score inside a filling, tick-marked ring (colour follows the live grade).
import { C, gradeColor, gradeFor } from "@/components/shared/tokens";
import { useCountUp } from "@/components/shared/useCountUp";
import { cn } from "@/lib/utils";

const R = 68;
const CIRC = 2 * Math.PI * R;
const TICKS = Array.from({ length: 40 }, (_, i) => {
  const a = (i / 40) * Math.PI * 2;
  return {
    x1: (8000 + Math.round(7800 * Math.cos(a))) / 100,
    y1: (8000 + Math.round(7800 * Math.sin(a))) / 100,
    x2: (8000 + Math.round(7500 * Math.cos(a))) / 100,
    y2: (8000 + Math.round(7500 * Math.sin(a))) / 100,
  };
});

/** Size it with className (e.g. "size-[124px]"); the number scales with the ring via container units. */
export function ScoreRing({ score, className }: { score?: number; className?: string }) {
  const shown = useCountUp(score ?? null, { duration: 1.1, delay: 0.15 });
  const has = score != null;
  const color = has ? gradeColor(gradeFor(shown)) : C.dim;
  return (
    <div className={cn("relative size-[132px] shrink-0 [container-type:inline-size]", className)}>
      <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
        <circle cx="80" cy="80" r={R} fill="none" stroke={C.surface3} strokeWidth="9" />
        {TICKS.map((t, i) => (
          <line key={i} {...t} stroke={C.dim} strokeOpacity="0.3" strokeWidth="1" />
        ))}
        {has && (
          <circle
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - Math.max(0, Math.min(100, shown)) / 100)}
            style={{ filter: `drop-shadow(0 0 7px ${color})`, transition: "stroke 300ms" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display leading-none tabular" style={{ fontSize: "40cqw", color: has ? C.text : C.dim }}>
          {has ? Math.round(shown) : "--"}
        </span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-dim">/ 100</span>
      </div>
    </div>
  );
}
