// Choose the one moment to analyse from the video model's events (spec §7.3).
import type { ExerciseId, ScanEvent } from "../types";
import { RULES } from "../exercises/rules";

export interface PickContext {
  duration: number;
  exercise?: ExerciseId;
}

/** Keywords per exercise that indicate the issue is one our rules can measure. */
const KEYWORDS: Record<ExerciseId, string[]> = {
  squat: ["depth", "shallow", "parallel", "lean", "torso", "trunk", "chest", "knee", "cave", "valgus", "heel", "hip"],
  bench_press: ["elbow", "flare", "tuck", "forearm", "wrist", "stack", "abduct", "shoulder"],
  deadlift: ["back", "round", "spine", "hip", "lockout", "hyperext", "lean", "bar", "path", "drift", "shin"],
  overhead_press: ["lean", "arch", "back", "lockout", "elbow", "bar", "path", "forward", "rib"],
  biceps_curl: ["elbow", "drift", "swing", "torso", "momentum", "range", "rom", "partial"],
  pull_up: ["range", "rom", "partial", "chin", "bar", "elbow", "kip", "kick", "knee", "leg", "swing", "sway", "uneven", "shoulder", "shrug", "asym", "hang"],
};

export function issueMatchesRules(e: Pick<ScanEvent, "issue" | "body_part" | "description">, exercise?: ExerciseId): boolean {
  if (!exercise) return false;
  const text = `${e.issue} ${e.body_part}`.toLowerCase().replace(/[_-]/g, " ");
  const words = new Set(KEYWORDS[exercise]);
  for (const r of RULES[exercise]) {
    for (const w of r.angleKey.split("_")) if (w.length > 3) words.add(w);
  }
  return [...words].some((w) => text.includes(w));
}

/** Edge zone (s) where reps are partial / blurred. */
export const EDGE_S = 0.3;

export function scoreEvent(e: ScanEvent, ctx: PickContext): number {
  const sev = Number.isFinite(e.severity) ? e.severity : 0;
  const conf = Number.isFinite(e.confidence) ? e.confidence : 0;
  let s = sev * 0.6 + conf * 5 * 0.3;
  if (issueMatchesRules(e, ctx.exercise)) s += 0.5;
  const d = ctx.duration;
  const t = e.t_peak;
  if (d > 0 && t >= d * 0.25 && t <= d * 0.75) s += 0.2;
  if (t < EDGE_S || (d > 0 && t > d - EDGE_S)) s -= 0.5;
  return s;
}

/** Highest-scoring event (first wins ties), or null when there are none. */
export function pickMoment(events: readonly ScanEvent[], ctx: PickContext): ScanEvent | null {
  let best: ScanEvent | null = null;
  let bestScore = -Infinity;
  for (const e of events) {
    const s = scoreEvent(e, ctx);
    if (s > bestScore) {
      best = e;
      bestScore = s;
    }
  }
  return best;
}
