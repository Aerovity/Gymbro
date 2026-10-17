"use client";
// The "see the fix" bar under the photo: the target-form (ghost) toggle, and the optional, on-demand
// "Generate AI photo of the fix" action (GPT Image edit → re-measured) with idle / working / failed / done states.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BadgeCheck, CircleAlert, RotateCcw, WandSparkles } from "lucide-react";
import type { AiPhotoState } from "@/lib/store/pipeline";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

const COPY: Record<string, string[]> = {
  push_up: [
    "Straightening your body line…",
    "Stacking your shoulders over your wrists…",
    "Tucking your elbows to about 45°…",
    "Lowering your chest to the floor…",
    "Matching your lighting…",
    "Keeping it you — same face, same kit…",
  ],
  pull_up: [
    "Leveling your shoulders…",
    "Pulling your chin over the bar…",
    "Driving your elbows to your ribs…",
    "Straightening your legs…",
    "Matching your gym's lighting…",
    "Keeping it you — same face, same kit…",
  ],
  default: ["Rebuilding your form…", "Matching your gym's lighting…", "Keeping it you — same face, same kit…"],
};

export interface AiPhotoPanelProps {
  state: AiPhotoState;
  error?: string;
  exercise?: string;
  /** An after photo is on screen (slider mode). */
  hasAfter: boolean;
  /** Cached sample: the after photo is pre-made, no regenerate. */
  cached?: boolean;
  showGhost: boolean;
  onToggleGhost: () => void;
  canGhost: boolean;
  onGenerate: () => void;
  /** e.g. "Elbow at top 98° → 62°" */
  verifyLine?: string;
  verifyPassed?: boolean;
  className?: string;
}

function useRotating(lines: string[], on: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setI((n) => n + 1), 3200);
    return () => clearInterval(id);
  }, [on]);
  return lines[i % lines.length];
}

const ctaBase = "inline-flex h-12 w-full items-center gap-2.5 rounded-xl px-5 text-[14.5px] font-bold transition-all duration-200 @2xl:w-auto";

export function AiPhotoPanel({ state, error, exercise, hasAfter, cached, showGhost, onToggleGhost, canGhost, onGenerate, verifyLine, verifyPassed, className }: AiPhotoPanelProps) {
  const reduce = useReducedMotion();
  const working = state === "generating" || state === "verifying";
  const lines = COPY[exercise ?? ""] ?? COPY.default;
  const line = useRotating(state === "verifying" ? ["Re-measuring every joint on the AI photo…"] : lines, working);
  const failed = state === "failed";
  const showAction = !hasAfter || working;

  return (
    <div className={cn("@container rounded-2xl border border-line bg-surface/70", className)}>
      <div className="flex flex-col gap-3 p-3 @2xl:flex-row @2xl:items-center @2xl:gap-4 @2xl:p-3.5">
        {/* What you're looking at */}
        <div className="min-w-0 flex-1">
          {hasAfter ? (
            <div className="flex items-start gap-2.5 px-1">
              <BadgeCheck className={cn("mt-0.5 size-[18px] shrink-0", verifyPassed === false ? "text-amber" : "text-volt")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-text">
                  {cached ? "Cached AI photo of the fix" : "AI photo of the fix"}
                  {state === "verifying" && <span className="ml-2 text-[12.5px] font-medium text-cyan">re-measuring…</span>}
                </div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-dim">
                  {verifyLine ? (
                    <>
                      Re-measured on the photo: <span className={cn("whitespace-nowrap font-mono font-semibold tabular", verifyPassed === false ? "text-amber" : "text-volt")}>{verifyLine}</span>
                    </>
                  ) : (
                    "Drag the handle to compare."
                  )}
                </div>
              </div>
              {!working &&
                (cached ? (
                  <span data-testid="ai-photo-btn" data-state={state} className="shrink-0 rounded-full border border-line bg-surface-3 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
                    Cached
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="ai-photo-btn"
                    data-state={state}
                    onClick={onGenerate}
                    className="-my-1 inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-dim transition-colors hover:bg-surface-3 hover:text-text"
                  >
                    <RotateCcw className="size-3.5" aria-hidden /> Regenerate
                  </button>
                ))}
            </div>
          ) : (
            <label className={cn("flex items-center gap-3 rounded-xl px-1 py-0.5", canGhost ? "cursor-pointer" : "cursor-not-allowed opacity-50")}>
              <Switch checked={showGhost && canGhost} disabled={!canGhost} onCheckedChange={() => onToggleGhost()} aria-label="Show target form" className="data-checked:bg-volt" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-text">Show target form</span>
                <span className="block text-[12.5px] leading-snug text-dim">{canGhost ? "Dashed lime = where your joints should be" : "Every measured joint is already in range"}</span>
              </span>
            </label>
          )}
        </div>

        {/* The optional AI photo */}
        {showAction && (
          <div className="flex shrink-0 flex-col gap-1.5 @2xl:items-end">
            {(state === "idle" || state === "done") && (
              <>
                <button
                  type="button"
                  data-testid="ai-photo-btn"
                  data-state={state}
                  onClick={onGenerate}
                  className={cn(ctaBase, "group cursor-pointer justify-center border border-volt/55 bg-volt/[0.08] text-volt hover:bg-volt hover:text-bg hover:shadow-[var(--shadow-glow-volt)]")}
                >
                  <WandSparkles className="size-[18px] shrink-0 transition-transform duration-300 group-hover:rotate-12" aria-hidden />
                  <span className="whitespace-nowrap">Generate AI photo of the fix</span>
                </button>
                <span className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-dim @2xl:text-right">Optional · ~30 s · uses GPT Image</span>
              </>
            )}

            {working && (
              <>
                <button
                  type="button"
                  data-testid="ai-photo-btn"
                  data-state={state}
                  disabled
                  aria-busy
                  className={cn(ctaBase, "relative cursor-progress justify-center overflow-hidden border border-volt/30 bg-surface-2 text-text @2xl:min-w-[290px]")}
                >
                  {!reduce && (
                    <motion.span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-volt/20 to-transparent" animate={{ x: ["-120%", "320%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
                  )}
                  <WandSparkles className="relative size-[18px] shrink-0 text-volt" aria-hidden />
                  <span className="relative">{state === "verifying" ? "Checking the fix…" : "Generating your AI photo…"}</span>
                </button>
                <span className="h-4 overflow-hidden px-1 text-center text-[12px] text-volt/90 @2xl:text-right" role="status" aria-live="polite">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={line} className="block truncate" initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.22 }}>
                      {line}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </>
            )}

            {failed && (
              <>
                <span role="alert" className="flex items-start gap-1.5 px-1 text-[12.5px] leading-snug text-amber">
                  <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{error ?? "Couldn't make the AI photo this time."} The target form still shows the fix.</span>
                </span>
                <button
                  type="button"
                  data-testid="ai-photo-btn"
                  data-state={state}
                  onClick={onGenerate}
                  className={cn(ctaBase, "h-11 cursor-pointer justify-center border border-line bg-surface-2 text-text hover:border-volt/50 hover:bg-surface-3")}
                >
                  <RotateCcw className="size-4" aria-hidden /> Try the AI photo again
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
