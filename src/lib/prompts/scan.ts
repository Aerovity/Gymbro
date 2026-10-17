// Video-model scan prompt (spec §8.1), plus pull-up.
import { EXERCISES, type ExerciseChoice, type View } from "@/lib/types";
import { EXERCISE_INFO } from "@/lib/exercises/catalog";

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

export function exerciseLine(exercise: ExerciseChoice): string {
  return exercise === "auto"
    ? `unknown — classify it as one of: ${EXERCISES.join(", ")}`
    : `${exercise} (${EXERCISE_INFO[exercise].human})`;
}

export function faultsList(): string {
  return EXERCISES.map((id) => `- ${id}: ${EXERCISE_INFO[id].faults}`).join("\n");
}

export function buildScanPrompt(input: ScanPromptInput): string {
  const view = input.view && input.view !== "angled" ? input.view : "unknown";
  const d = fmt(input.duration);
  const lines = [
    `Exercise: ${exerciseLine(input.exercise)}.`,
    `Camera view: ${view}${input.exercise === "pull_up" ? " (front and rear views are both \"front\")" : ""}.`,
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
    faultsList(),
    "",
    "Return exactly this JSON shape (replace every <placeholder> with what you actually observe — never copy placeholder text):",
    `{"exercise":"<${EXERCISES.join("|")}>","view":"<side|front|angled>","rep_count":<integer>,`,
    ' "events":[{"t_start":<seconds>,"t_peak":<seconds, one of the frame timestamps>,"t_end":<seconds>,"rep_index":<0-based rep number>,"issue":"<snake_case_fault>","body_part":"<body part>","severity":<1-5>,"confidence":<0-1>,"description":"<what you saw, max 25 words>"}],',
    ' "overall":"<your one-sentence verdict on this specific set>"}',
    `Rules: severity is 1-5. confidence is 0-1. Up to 5 events, most severe first. Timestamps must be within 0 and ${d}. If form is good, return "events": [].`,
  );
  if (input.reasoning) lines.push(REASONING_INSTRUCTION);
  return lines.join("\n");
}
