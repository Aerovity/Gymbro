// OpenAI coach prompts and strict JSON schema (spec §8.2).
import type { CoachRequest } from "@/lib/schemas";
import { EXERCISE_INFO } from "@/lib/exercises/catalog";

export const COACH_SYSTEM_PROMPT = `You are "Gym Bro", an elite but friendly strength coach and biomechanics nerd. You are looking at ONE frame from a lifter's set — the moment where an AI video model flagged a technique fault — plus PRECISE joint angles measured by a pose-estimation model.

Hard rules:
1. The measured angles are ground truth. Quote them exactly (round to whole degrees). Never invent a measurement that is not provided. If an angle is marked unreliable, do not quote it; you may mention it qualitatively ("hard to see from this angle").
2. Use the provided target ranges. You may tighten a target only with a stated reason (e.g. lifter's build visible in the frame).
3. Diagnose the SINGLE most important fault first, then at most two secondary ones.
4. Corrections must be concrete, physical cues a lifter can apply on the next rep (e.g. "spread the floor", "bend the bar", "elbows to 60°, aim the bar at your lower sternum").
5. Be encouraging, punchy, gym-floor tone. No medical diagnoses. If something looks painful or dangerous, advise reducing load and consulting a qualified coach or physio.
6. Do not penalise knees travelling past toes in a deep squat — that is normal.
7. Write spoken_summary as 2–4 short sentences meant to be read aloud (no symbols except °).
8. Output must match the JSON schema exactly.`;

const r0 = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : String(Math.round(n)));
const r2 = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : String(Math.round(n * 100) / 100);

export function buildCoachUserPrompt(p: CoachRequest): string {
  const ev = p.cosmosEvent;
  const rep = p.repIndex ?? ev?.rep_index;
  const angleLines = p.angles
    .map((a) => {
      const isRatio = a.unit === "ratio";
      const v = isRatio ? r2(a.value) : r0(a.value);
      const u = isRatio ? " (ratio)" : "°";
      const t = a.target;
      const range = t
        ? `target ${t.min !== undefined ? (isRatio ? r2(t.min) : r0(t.min)) : "—"}–${
            t.max !== undefined ? (isRatio ? r2(t.max) : r0(t.max)) : "—"
          }${isRatio ? "" : "°"} (ideal ${isRatio ? r2(t.ideal) : r0(t.ideal)}${isRatio ? "" : "°"})`
        : "no target";
      return `- ${a.key} (${a.label}): actual ${v}${a.value === null ? "" : u}, ${range}, status ${a.status}, reliable ${a.reliable}${
        a.variant ? `, direction ${a.variant}` : ""
      }${a.note ? ` — ${a.note}` : ""}`;
    })
    .join("\n");

  const finding = ev
    ? `Video model finding: "${ev.description}" (issue: ${ev.issue}, severity ${ev.severity}/5, provider ${p.provider})`
    : `Video model finding: none (provider ${p.provider})`;
  const info = EXERCISE_INFO[p.exercise];

  return [
    `Exercise: ${p.exercise} (${info.human}) | Camera view: ${p.view} (measuring side: ${p.side}) | Timestamp: ${r2(
      p.t,
    )}s (rep ${rep ?? "unknown"})`,
    `Correct ${info.human} technique: ${info.editHint}`,
    `Typical ${info.human} faults: ${info.faults}.`,
    finding,
    "",
    "Measured angles (degrees; interior joint angle unless stated):",
    angleLines || "- none measurable",
    `Rule violations detected by code: ${JSON.stringify(p.violations)}`,
    `Keypoints (pixel coords in a ${Math.round(p.W)}x${Math.round(p.H)} image, visibility 0–1): ${JSON.stringify(p.keypoints)}`,
    "",
    "Explain what is wrong and how to fix it. Provide target angles for the corrected position (these will be used to generate a corrected image).",
  ].join("\n");
}

/** Strict structured-output schema. `spoken_summary` MUST stay first (streamed to the UI). */
export const COACH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "spoken_summary",
    "headline",
    "primary_fault",
    "secondary_faults",
    "angle_feedback",
    "cues",
    "drill",
    "corrected_pose",
    "safety_note",
    "form_score_adjustment",
  ],
  properties: {
    spoken_summary: { type: "string" },
    headline: { type: "string", description: "≤8 words, scoreboard style, e.g. 'ELBOWS FLARING — TUCK TO 60°'" },
    primary_fault: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "explanation", "body_part", "severity"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        explanation: { type: "string" },
        body_part: { type: "string" },
        severity: { type: "integer", minimum: 1, maximum: 5 },
      },
    },
    secondary_faults: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "explanation"],
        properties: { title: { type: "string" }, explanation: { type: "string" } },
      },
    },
    angle_feedback: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "angle_key",
          "actual_deg",
          "target_min_deg",
          "target_max_deg",
          "target_ideal_deg",
          "verdict",
          "comment",
        ],
        properties: {
          angle_key: { type: "string" },
          actual_deg: { type: ["number", "null"] },
          target_min_deg: { type: "number" },
          target_max_deg: { type: "number" },
          target_ideal_deg: { type: "number" },
          verdict: { type: "string", enum: ["good", "borderline", "bad", "unmeasurable"] },
          comment: { type: "string" },
        },
      },
    },
    cues: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
    drill: {
      type: "object",
      additionalProperties: false,
      required: ["name", "prescription", "why"],
      properties: { name: { type: "string" }, prescription: { type: "string" }, why: { type: "string" } },
    },
    corrected_pose: {
      type: "object",
      additionalProperties: false,
      required: ["description", "joint_targets"],
      properties: {
        description: {
          type: "string",
          description: "Plain-language description of the corrected body position for an image editor",
        },
        joint_targets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["angle_key", "target_deg"],
            properties: { angle_key: { type: "string" }, target_deg: { type: "number" } },
          },
        },
      },
    },
    safety_note: { type: ["string", "null"] },
    form_score_adjustment: { type: "integer", minimum: -10, maximum: 10 },
  },
} as const;
