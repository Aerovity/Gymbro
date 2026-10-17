// GPT contact-sheet fallback prompt (spec §8.3) and the strict JSON schema version of ScanModelOutput.
import type { ExerciseChoice, View } from "@/lib/types";
import { EXERCISE_ORDER } from "@/lib/exercises/catalog";
import { exerciseLine, exerciseOptions, faultsList } from "./scan";

export const PICK_SYSTEM_PROMPT =
  "You are a strength coach. The image is a 4×4 contact sheet of frames from one set; each cell is labelled with its timestamp. Identify the frames with the clearest technique faults. Only report faults you can actually see.";

export const PICK_FRAMES_SYSTEM_PROMPT =
  "You are a strength coach. The images are frames from one set in time order; each is labelled with its timestamp. Identify the frames with the clearest technique faults. Only report faults you can actually see.";

export interface PickPromptInput {
  exercise: ExerciseChoice;
  view?: View;
  duration: number;
  timestamps: number[];
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function buildPickPrompt(input: PickPromptInput): string {
  return [
    `Exercise: ${exerciseLine(input.exercise)}.`,
    `Camera view: ${input.view ?? "unknown"}.`,
    `Clip duration: ${fmt(input.duration)} s.`,
    `Labelled timestamps (seconds, in reading order): ${input.timestamps.map(fmt).join(", ")}.`,
    "",
    "Common faults to look for:",
    faultsList(input.exercise),
    "",
    "For each fault, t_peak MUST equal one of the labelled timestamps (the frame where the fault is most visible); t_start/t_end bracket it using neighbouring labels.",
    `exercise must be one of ${exerciseOptions(", ")} (or null if unsure).`,
    "severity is 1-5, confidence is 0-1. Up to 5 events, most severe first. Use null for unknown optional fields. If form is good, return an empty events array.",
  ].join("\n");
}

const nullable = (type: string) => ({ type: [type, "null"] });

/** Strict-mode JSON schema mirroring ScanModelOutputSchema (optional fields become nullable). */
export const SCAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["exercise", "view", "rep_count", "events", "overall"],
  properties: {
    // Only the offered exercises (push_up | pull_up): the app can't analyse anything else.
    exercise: { type: ["string", "null"], enum: [...EXERCISE_ORDER, null] },
    view: { type: ["string", "null"], enum: ["side", "front", "angled", "unknown", null] },
    rep_count: nullable("integer"),
    events: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "t_start",
          "t_peak",
          "t_end",
          "rep_index",
          "issue",
          "body_part",
          "severity",
          "confidence",
          "description",
        ],
        properties: {
          t_start: { type: "number" },
          t_peak: { type: "number" },
          t_end: { type: "number" },
          rep_index: nullable("integer"),
          issue: { type: "string", description: "snake_case fault id, e.g. partial_range_top" },
          body_part: { type: "string" },
          severity: { type: "number", minimum: 1, maximum: 5 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          description: { type: "string" },
        },
      },
    },
    overall: nullable("string"),
  },
} as const;
