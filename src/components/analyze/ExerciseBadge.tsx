"use client";
// Exercise badge for the analyze screens ("Push-up · 92%") and, on results, a small "Change" menu
// that re-analyses the clip as the other exercise.
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import type { ExerciseId } from "@/lib/types";
import type { DetectedExercise } from "@/lib/store/pipeline";
import { EXERCISE_ORDER } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";
import { ExerciseIcon, exerciseLabel } from "@/components/shared/exercise";

export interface ExerciseBadgeProps {
  exercise: ExerciseId;
  detected?: DetectedExercise;
  /** Prefix shown before the name, e.g. "Detected:" while analysing. */
  prefix?: string;
  demo?: boolean;
  /** Show the "· 92%" / "· your pick" / "· sample" note (default true). */
  showNote?: boolean;
  /** Re-analyse as another exercise; omit to hide the Change menu. */
  onChange?: (ex: ExerciseId) => void;
  className?: string;
}

function sourceNote(d: DetectedExercise | undefined, demo?: boolean): string | undefined {
  if (demo || d?.source === "demo") return "sample";
  if (!d) return undefined;
  if (d.source === "user") return "your pick";
  return `${Math.round(d.confidence * 100)}%`;
}

export function ExerciseBadge({ exercise, detected, prefix, demo, showNote = true, onChange, className }: ExerciseBadgeProps) {
  const note = showNote ? sourceNote(detected, demo) : undefined;
  const title = detected?.reason ? `${detected.source === "user" ? "You picked" : "Detected"}: ${detected.reason}` : undefined;
  return (
    <div className={cn("inline-flex h-10 items-stretch overflow-hidden rounded-xl border border-line bg-surface-2/80", className)}>
      <span data-testid="exercise-badge" title={title} className="inline-flex items-center gap-2 pl-3 pr-3 text-[13.5px] font-semibold text-text">
        <ExerciseIcon exercise={exercise} className="size-4 text-volt" />
        {prefix && <span className="font-medium text-dim">{prefix}</span>}
        <span>{exerciseLabel(exercise)}</span>
        {note && <span className="font-mono text-[11px] font-medium tabular text-dim">· {note}</span>}
      </span>
      {onChange && !demo && (
        <Menu.Root>
          <Menu.Trigger
            data-testid="exercise-change-btn"
            aria-label={`Change exercise (now ${exerciseLabel(exercise)})`}
            className="inline-flex cursor-pointer items-center gap-1 border-l border-line px-2.5 text-[12.5px] font-semibold text-dim outline-none transition-colors hover:bg-surface-3 hover:text-text focus-visible:bg-surface-3 focus-visible:text-text data-popup-open:bg-surface-3 data-popup-open:text-text"
          >
            <span className="hidden sm:inline">Change</span>
            <ChevronDown className="size-3.5" aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="z-50 outline-none" sideOffset={8} align="start">
              <Menu.Popup className="min-w-[230px] origin-[var(--transform-origin)] rounded-xl border border-line bg-surface-2 p-1.5 shadow-[0_24px_48px_-16px_rgb(0_0_0/0.85)] outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
                <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">Analyse this clip as</div>
                {EXERCISE_ORDER.map((id) => {
                  const current = id === exercise;
                  return (
                    <Menu.Item
                      key={id}
                      data-testid={`exercise-change-${id}`}
                      onClick={() => {
                        if (!current) onChange(id);
                      }}
                      className={cn(
                        "flex h-10 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium outline-none data-highlighted:bg-surface-3",
                        current ? "text-volt" : "text-text",
                      )}
                    >
                      <ExerciseIcon exercise={id} className="size-4" />
                      <span className="flex-1">{exerciseLabel(id)}</span>
                      {current && <Check className="size-4" strokeWidth={2.5} aria-label="current" />}
                    </Menu.Item>
                  );
                })}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
}
