// UI helpers for exercises and providers: labels, icons and honest scan-provider names.
import { createElement } from "react";
import { ArrowDownToLine, ArrowUpToLine, BicepsFlexed, ChevronsDown, ChevronsUp, Dumbbell, Sparkles, Weight, type LucideIcon } from "lucide-react";
import type { ExerciseChoice, ProviderId } from "@/lib/types";
import { EXERCISE_INFO, type ExerciseInfo } from "@/lib/exercises/catalog";
import { humanize } from "./tokens";

const INFO = EXERCISE_INFO as Partial<Record<string, ExerciseInfo>>;

const ICONS: Record<string, LucideIcon> = {
  auto: Sparkles,
  push_up: ArrowDownToLine,
  pull_up: ArrowUpToLine,
  squat: ChevronsDown,
  bench_press: Dumbbell,
  deadlift: Weight,
  overhead_press: ChevronsUp,
  biceps_curl: BicepsFlexed,
};

export const exerciseIcon = (ex: ExerciseChoice | string | undefined): LucideIcon => (ex && ICONS[ex]) || Sparkles;

/** Icon for an exercise (push-up ↓ to the floor, pull-up ↑ to the bar). */
export function ExerciseIcon({ exercise, className }: { exercise: ExerciseChoice | string | undefined; className?: string }) {
  return createElement(exerciseIcon(exercise), { className, "aria-hidden": true });
}

/** "Push-up" (falls back to a humanised id while the catalog is catching up). */
export const exerciseLabel = (ex: ExerciseChoice | string | undefined): string =>
  !ex ? "" : ex === "auto" ? "Auto-detect" : (INFO[ex]?.short ?? INFO[ex]?.label ?? humanize(ex));

export const exerciseInfo = (ex: string | undefined): ExerciseInfo | undefined => (ex ? INFO[ex] : undefined);

/**
 * Honest name for the scan provider. Only claims Cosmos when the provider IS cosmos;
 * otherwise uses the generic "NVIDIA video AI" (cached runs are labelled cached).
 */
export function scanProviderLabel(provider: ProviderId | undefined): string {
  switch (provider) {
    case "cosmos":
      return "NVIDIA Cosmos";
    case "nemotron":
      return "NVIDIA Nemotron";
    case "gpt-fallback":
      return "GPT vision";
    case "pose-only":
      return "On-device pose scan";
    case "demo":
      return "NVIDIA video AI · cached";
    default:
      return "NVIDIA video AI";
  }
}

export const isScanFallback = (provider: ProviderId | undefined) => provider === "gpt-fallback" || provider === "pose-only";
