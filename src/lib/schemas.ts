// Zod schemas for every API boundary and every LLM JSON output.
// Client + server safe. Types are inferred and exported alongside.
import { z } from "zod";
import { EXERCISES } from "./types";

export const ExerciseIdSchema = z.enum(EXERCISES);
export const ExerciseChoiceSchema = z.union([ExerciseIdSchema, z.literal("auto")]);
export const ViewSchema = z.enum(["side", "front", "angled", "unknown"]);
export const SideSchema = z.enum(["left", "right", "both"]);
export const ProviderIdSchema = z.enum(["cosmos", "nemotron", "gpt-fallback", "pose-only", "demo"]);
export const EditSizeSchema = z.enum(["1024x1536", "1536x1024", "1024x1024"]);

// ───────────── Scan (video model) ─────────────

export const ScanEventSchema = z.object({
  t_start: z.number().nonnegative(),
  t_peak: z.number().nonnegative(),
  t_end: z.number().nonnegative(),
  rep_index: z.number().int().nonnegative().optional(),
  issue: z.string().min(2).max(60),
  body_part: z.string().max(30),
  severity: z.number().min(1).max(5),
  confidence: z.number().min(0).max(1),
  description: z.string().max(300),
});

/** What the video model must return (after tolerant parsing / coercion). */
export const ScanModelOutputSchema = z.object({
  exercise: ExerciseIdSchema.optional(),
  view: ViewSchema.optional(),
  rep_count: z.number().int().nonnegative().optional(),
  events: z.array(ScanEventSchema).max(8),
  overall: z.string().max(400).optional(),
});
export type ScanModelOutput = z.infer<typeof ScanModelOutputSchema>;

export const TraceEntrySchema = z.object({
  step: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  ok: z.boolean(),
  ms: z.number(),
  error: z.string().optional(),
  detail: z.string().optional(),
  fallback: z.boolean().optional(),
});

export const FrameSchema = z.object({
  t: z.number().nonnegative(),
  dataUrl: z.string().startsWith("data:image/"),
});

export const ScanRequestSchema = z.object({
  exercise: ExerciseChoiceSchema,
  view: ViewSchema.optional(),
  duration: z.number().positive().max(120),
  effectiveFps: z.number().positive().max(10),
  frames: z.array(FrameSchema).min(1).max(40),
  /** Optional 4×4 contact sheet (used by the GPT fallback inside the chain). */
  contactSheetDataUrl: z.string().startsWith("data:image/").optional(),
  contactSheetTimestamps: z.array(z.number()).optional(),
  videoDataUrl: z.string().startsWith("data:video/").optional(),
});
export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const ScanResultSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string(),
  exercise: ExerciseIdSchema.optional(),
  view: ViewSchema.optional(),
  repCount: z.number().int().nonnegative().optional(),
  events: z.array(ScanEventSchema),
  overall: z.string().optional(),
  raw: z.string(),
  trace: z.array(TraceEntrySchema),
});

export const PickFrameRequestSchema = z.object({
  exercise: ExerciseChoiceSchema,
  duration: z.number().positive(),
  contactSheetDataUrl: z.string().startsWith("data:image/"),
  timestamps: z.array(z.number().nonnegative()).min(1).max(25),
});
export type PickFrameRequest = z.infer<typeof PickFrameRequestSchema>;

// ───────────── Coach ─────────────

export const TargetRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  ideal: z.number(),
});

export const AngleMeasurementSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.enum(["°", "ratio"]),
  points: z.tuple([z.number(), z.number(), z.number()]).optional(),
  reliable: z.boolean(),
  target: TargetRangeSchema.optional(),
  status: z.enum(["good", "borderline", "bad", "unmeasurable"]),
  deviation: z.number(),
  ruleId: z.string().optional(),
  note: z.string().optional(),
});

export const RuleViolationSchema = z.object({
  ruleId: z.string(),
  label: z.string(),
  angleKey: z.string(),
  actual: z.number(),
  target: TargetRangeSchema,
  deviation: z.number(),
  severity: z.number(),
  cue: z.string(),
  basis: z.enum(["literature", "heuristic"]),
  citation: z.string().optional(),
});

export const CompactKeypointSchema = z.object({
  i: z.number().int(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  v: z.number(),
});

export const CoachRequestSchema = z.object({
  exercise: ExerciseIdSchema,
  view: ViewSchema,
  side: SideSchema,
  t: z.number().nonnegative(),
  repIndex: z.number().int().nonnegative().optional(),
  cosmosEvent: ScanEventSchema.optional(),
  provider: ProviderIdSchema,
  angles: z.array(AngleMeasurementSchema),
  violations: z.array(RuleViolationSchema),
  keypoints: z.array(CompactKeypointSchema).max(33),
  frameDataUrl: z.string().startsWith("data:image/"),
  W: z.number().positive(),
  H: z.number().positive(),
});
export type CoachRequest = z.infer<typeof CoachRequestSchema>;

/** Mirrors COACH_JSON_SCHEMA (strict structured output). `spoken_summary` MUST be first for streaming. */
export const CoachReportSchema = z.object({
  spoken_summary: z.string(),
  headline: z.string(),
  primary_fault: z.object({
    id: z.string(),
    title: z.string(),
    explanation: z.string(),
    body_part: z.string(),
    severity: z.number().int().min(1).max(5),
  }),
  secondary_faults: z
    .array(z.object({ title: z.string(), explanation: z.string() }))
    .max(2),
  angle_feedback: z.array(
    z.object({
      angle_key: z.string(),
      actual_deg: z.number().nullable(),
      target_min_deg: z.number(),
      target_max_deg: z.number(),
      target_ideal_deg: z.number(),
      verdict: z.enum(["good", "borderline", "bad", "unmeasurable"]),
      comment: z.string(),
    }),
  ),
  cues: z.array(z.string()).min(1).max(4),
  drill: z.object({ name: z.string(), prescription: z.string(), why: z.string() }),
  corrected_pose: z.object({
    description: z.string(),
    joint_targets: z.array(z.object({ angle_key: z.string(), target_deg: z.number() })),
  }),
  safety_note: z.string().nullable(),
  form_score_adjustment: z.number().int().min(-10).max(10),
});
export type CoachReport = z.infer<typeof CoachReportSchema>;

// ───────────── Correct (image edit) ─────────────

export const CorrectRequestSchema = z.object({
  exercise: ExerciseIdSchema,
  beforeDataUrl: z.string().startsWith("data:image/"),
  size: EditSizeSchema,
  correctedPose: CoachReportSchema.shape.corrected_pose,
  primaryFault: z.string().max(200),
  attempt: z.union([z.literal(1), z.literal(2)]).optional(),
  measuredMiss: z.string().max(300).optional(),
});
export type CorrectRequest = z.infer<typeof CorrectRequestSchema>;

export const CorrectResponseSchema = z.object({
  imageDataUrl: z.string().startsWith("data:image/"),
  model: z.string(),
  ms: z.number(),
  revisedPrompt: z.string().optional(),
  prompt: z.string().optional(),
});
export type CorrectResponse = z.infer<typeof CorrectResponseSchema>;

// ───────────── TTS / Health / Errors ─────────────

export const TtsRequestSchema = z.object({ text: z.string().min(1).max(600) });

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  demo: z.boolean(),
  mock: z.boolean(),
  providers: z.object({
    cosmos: z.boolean(),
    nemotron: z.boolean(),
    openai: z.boolean(),
    tts: z.boolean(),
  }),
  probe: z.record(z.string(), z.object({ ok: z.boolean(), ms: z.number(), detail: z.string().optional() })).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  trace: z.array(TraceEntrySchema).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Hard cap for any JSON request body (Vercel limit is 4.5 MB). */
export const MAX_BODY_BYTES = 4.4 * 1024 * 1024;
/** Client-side target budget for scan payloads. */
export const SCAN_PAYLOAD_BUDGET = 3.8 * 1024 * 1024;
