"use client";
// One measured joint metric: gauge + "actual / target / to go" + verified-after row.
import { Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { AngleMeasurement } from "@/lib/types";
import { cn } from "@/lib/utils";
import { VerdictIcon } from "@/components/shared/Broadcast";
import { fmtGap, fmtTarget, fmtValue, toGo, verdictClass, verdictText } from "@/components/shared/tokens";
import { AngleGauge } from "./AngleGauge";

export interface AngleCardProps {
  m: AngleMeasurement;
  /** Same metric measured on the AFTER image (verify step). */
  after?: AngleMeasurement;
  /** Coach comment for this angle, if any. */
  comment?: string;
  index?: number;
  className?: string;
}

const ACCENT: Record<AngleMeasurement["status"], string> = {
  good: "before:bg-volt",
  borderline: "before:bg-amber",
  bad: "before:bg-signal",
  unmeasurable: "before:bg-line",
};

export function AngleCard({ m, after, comment, index = 0, className }: AngleCardProps) {
  const reduce = useReducedMotion();
  const d = toGo(m.value, m.target);
  return (
    <motion.article
      data-testid="angle-card"
      data-key={m.key}
      data-status={m.status}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: reduce ? 0 : index * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/90 p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
        "before:absolute before:inset-x-0 before:top-0 before:h-[3px]",
        ACCENT[m.status],
        className,
      )}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[17px] uppercase leading-tight tracking-wide text-text">{m.label}</h3>
          <p className={cn("mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em]", verdictClass(m.status))}>{verdictText[m.status]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("font-mono text-[26px] font-bold leading-none tabular", verdictClass(m.status))}>{fmtValue(m.value, m.unit)}</span>
          <VerdictIcon verdict={m.status} />
        </div>
      </header>

      <div className="mx-auto mt-2 w-full max-w-[210px]">
        <AngleGauge m={m} after={after?.value} className="w-full" />
      </div>

      <dl className="mt-3 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-bg/40">
        <div className="px-2 py-2 text-center">
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">Actual</dt>
          <dd className={cn("mt-0.5 font-mono text-sm font-semibold tabular", verdictClass(m.status))}>{fmtValue(m.value, m.unit)}</dd>
        </div>
        <div className="px-2 py-2 text-center">
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">Target</dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold tabular text-volt">{fmtTarget(m.target, m.unit)}</dd>
        </div>
        <div className="px-2 py-2 text-center">
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">Gap</dt>
          <dd className={cn("mt-0.5 font-mono text-sm font-semibold tabular", d ? verdictClass(m.status) : "text-volt")}>{fmtGap(d, m.unit)}</dd>
        </div>
      </dl>

      {after && after.value != null && (
        <div className={cn("mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]", after.status === "good" ? "bg-volt/10 text-volt" : "bg-amber/10 text-amber")}>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-80">After the fix</span>
          <span className="ml-auto font-mono font-bold tabular">{fmtValue(after.value, after.unit)}</span>
          <VerdictIcon verdict={after.status} className="size-[18px]" />
        </div>
      )}

      {(comment || m.note) && (
        <p className="mt-2.5 flex gap-1.5 text-[12.5px] leading-snug text-dim">
          {m.note && <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>{m.note ?? comment}</span>
        </p>
      )}
      {!m.reliable && !m.note && <p className="mt-2 text-[11.5px] text-dim">Low landmark confidence — treat as ±10°.</p>}
    </motion.article>
  );
}

export function AngleCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-[300px] flex-col rounded-2xl border border-line bg-surface/70 p-4", className)} aria-hidden>
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-3" />
      <div className="mt-2 h-2.5 w-1/3 animate-pulse rounded bg-surface-3" />
      <div className="mx-auto mt-6 h-[92px] w-[184px] animate-pulse rounded-t-full border-[12px] border-b-0 border-surface-3" />
      <div className="mt-auto h-12 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}
