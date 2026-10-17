"use client";
// Exercise chips: Auto + EXERCISE_ORDER (push-ups & pull-ups). Radio-group semantics, 44 px targets.
import type { ExerciseChoice } from "@/lib/types";
import { EXERCISE_ORDER } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";
import { ExerciseIcon, exerciseLabel } from "@/components/shared/exercise";

export interface ExercisePickerProps {
  value: ExerciseChoice;
  onChange: (v: ExerciseChoice) => void;
  className?: string;
}

export function ExercisePicker({ value, onChange, className }: ExercisePickerProps) {
  const opts: ExerciseChoice[] = ["auto", ...EXERCISE_ORDER];
  return (
    <div role="radiogroup" aria-label="Exercise" className={cn("flex flex-wrap gap-2", className)}>
      {opts.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`exercise-chip-${o}`}
            onClick={() => onChange(o)}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors duration-200",
              on ? "border-volt bg-volt text-bg shadow-[0_0_20px_-6px_var(--color-volt)]" : "border-line bg-surface-2/80 text-text hover:border-volt/40",
            )}
          >
            <ExerciseIcon exercise={o} className="size-4" />
            {o === "auto" ? "Auto-detect" : exerciseLabel(o)}
          </button>
        );
      })}
    </div>
  );
}
