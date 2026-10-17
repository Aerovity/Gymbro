// Video-model scan prompt (spec §8.1). The model may only answer with an offered exercise (EXERCISE_ORDER).
import type { ExerciseChoice, View } from "@/lib/types";
import { EXERCISE_INFO, EXERCISE_ORDER } from "@/lib/exercises/catalog";

export const SCAN_SYSTEM_PROMPT =
  'You are an expert strength coach analysing gym video for technique faults. Each frame has its timestamp printed at the bottom as "t=<seconds>s". Only report faults you can actually see. Respond with JSON only — no prose, no markdown.';

export const REASONING_INSTRUCTION =
  "Answer the question using the following format: <think>Your reasoning.</think> Write your final answer immediately after the </think> tag.";

export interface ScanPromptInput {
  exercise: ExerciseChoice;
  view?: View;
  duration: number;
  effectiveFps: number;
  reasoning?: boolean;
  /** When frames are sent as separate images, list their timestamps (in order) in the text. */
  frameTimes?: number[];
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** How the video model tells the offered exercises apart (auto mode). */
const LOOKS_LIKE: Partial<Record<string, string>> = {
  push_up: "body roughly horizontal facing the floor, hands on the floor",
  pull_up: "hanging from an overhead bar, hands above the head",
};

/** The exercises the video model may answer with, e.g. "push_up|pull_up". */
export const exerciseOptions = (sep = "|") => EXERCISE_ORDER.join(sep);

export function exerciseLine(exercise: ExerciseChoice): string {
  if (exercise !== "auto") return `${exercise} (${EXERCISE_INFO[exercise].human})`;
  const hints = EXERCISE_ORDER.map((id) => `${id} = ${LOOKS_LIKE[id] ?? EXERCISE_INFO[id].human}`).join("; ");
  return `unknown — classify it as exactly one of: ${exerciseOptions(", ")} (${hints})`;
}

/** Faults to look for: the chosen exercise's, or every offered exercise's in auto mode. */
export function faultsList(exercise: ExerciseChoice = "auto"): string {
  const ids = exercise === "auto" ? EXERCISE_ORDER : [exercise];
  return ids.map((id) => `- ${id}: ${EXERCISE_INFO[id].faults}`).join("\n");
}

export function buildScanPrompt(input: ScanPromptInput): string {
  const view = input.view && input.view !== "angled" ? input.view : "unknown";
  const d = fmt(input.duration);
  const lines = [
    `Exercise: ${exerciseLine(input.exercise)}.`,
    `Camera view: ${view} (front and rear views are both "front").`,
    `Clip duration: ${d} s. Frames sampled at ${fmt(input.effectiveFps)} fps.`,
  ];
  if (input.frameTimes?.length) {
    lines.push(
      `The ${input.frameTimes.length} images are consecutive frames in time order. Their timestamps (seconds) are: ${input.frameTimes
        .map(fmt)
        .join(", ")}.`,
    );
  }
  lines.push(
    "",
    'Task: Watch the whole set. Identify the moments where technique is clearly bad. For each, give the timestamp (in seconds, read from the burned-in "t=" label) of the frame where the fault is most visible.',
    "Common faults to look for:",
    faultsList(input.exercise),
    "",
    "Return exactly this JSON shape (replace every <placeholder> with what you actually observe — never copy placeholder text):",
    `{"exercise":"<${exerciseOptions()}>","view":"<side|front|angled>","rep_count":<integer>,`,
    ' "events":[{"t_start":<seconds>,"t_peak":<seconds, one of the frame timestamps>,"t_end":<seconds>,"rep_index":<0-based rep number>,"issue":"<snake_case_fault>","body_part":"<body part>","severity":<1-5>,"confidence":<0-1>,"description":"<what you saw, max 25 words>"}],',
    ' "overall":"<your one-sentence verdict on this specific set>"}',
    `Rules: severity is 1-5. confidence is 0-1. Up to 5 events, most severe first. Timestamps must be within 0 and ${d}. If form is good, return "events": [].`,
  );
  if (input.reasoning) lines.push(REASONING_INSTRUCTION);
  return lines.join("\n");
}
