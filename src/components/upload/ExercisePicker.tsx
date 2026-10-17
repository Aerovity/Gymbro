"use client";
// Exercise chips: Auto + EXERCISE_ORDER. Radio-group semantics, 44 px targets.
import { ArrowUpToLine, BicepsFlexed, ChevronsDown, ChevronsUp, Dumbbell, Sparkles, Weight } from "lucide-react";
import type { ExerciseChoice, ExerciseId } from "@/lib/types";
import { EXERCISE_INFO, EXERCISE_ORDER } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";

const ICON: Record<ExerciseId | "auto", typeof Sparkles> = {
  auto: Sparkles,
  pull_up: ArrowUpToLine,
  squat: ChevronsDown,
  bench_press: Dumbbell,
  deadlift: Weight,
  overhead_press: ChevronsUp,
  biceps_curl: BicepsFlexed,
};

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
        const Icon = ICON[o];
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
            <Icon className="size-4" aria-hidden />
            {o === "auto" ? "Auto-detect" : EXERCISE_INFO[o].short}
          </button>
        );
      })}
    </div>
  );
}
