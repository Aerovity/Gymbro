// Shared domain types for Gym Bro. Client + server safe (no runtime imports).
// API request/response shapes live in schemas.ts (Zod) and are re-exported as types there.

export const EXERCISES = [
  "squat",
  "bench_press",
  "deadlift",
  "overhead_press",
  "biceps_curl",
  "pull_up",
  "push_up",
] as const;
export type ExerciseId = (typeof EXERCISES)[number];
export type ExerciseChoice = ExerciseId | "auto";

export type View = "side" | "front" | "angled" | "unknown";
/** Which body side is measured. "both" = symmetric front/rear-view metrics. */
export type Side = "left" | "right" | "both";
export type ProviderId = "cosmos" | "nemotron" | "gpt-fallback" | "pose-only" | "demo";
export type DemoId = "pullup";

/** 2D point in PIXELS of the image being measured. */
export interface Pt {
  x: number;
  y: number;
}
export interface Pt3 extends Pt {
  z: number;
}

/** MediaPipe landmark. For `landmarks`: x,y normalised 0–1 (z relative depth). For `worldLandmarks`: metres, hip-centred. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** One detected person in one image. */
export interface PoseResult {
  landmarks: Landmark[]; // 33, normalised
  worldLandmarks: Landmark[]; // 33, metres
  width: number; // pixel size of the image the landmarks refer to
  height: number;
}

export interface VideoMeta {
  name: string;
  size: number;
  mime: string;
  duration: number;
  width: number; // rendered (rotation-applied) dimensions
  height: number;
  orientation: "portrait" | "landscape" | "square";
}

export interface SampledFrame {
  t: number; // seconds
  dataUrl: string; // JPEG data URL (timestamp burned in for scan frames)
  width: number;
  height: number;
}

/** A technique fault located in time by the video model. */
export interface ScanEvent {
  t_start: number;
  t_peak: number;
  t_end: number;
  rep_index?: number;
  issue: string;
  body_part: string;
  severity: number; // 1–5
  confidence: number; // 0–1
  description: string;
}

export interface TraceEntry {
  step: string; // e.g. "scan", "refine", "pose", "coach", "correct", "verify"
  provider?: string;
  model?: string;
  ok: boolean;
  ms: number;
  error?: string;
  detail?: string; // short human-readable note, e.g. "refined 0:07.2 → 0:07.4"
  fallback?: boolean; // true when this step used a fallback path
}

export interface ScanResult {
  provider: ProviderId;
  model: string;
  exercise?: ExerciseId;
  view?: View;
  repCount?: number;
  events: ScanEvent[];
  overall?: string;
  raw: string; // raw model text (shown in the Agent Trace drawer)
  trace: TraceEntry[];
}

export interface ChosenMoment {
  t: number;
  source: "cosmos" | "cosmos+pose-refine" | "pose-only" | "demo";
  event?: ScanEvent;
  refinedFrom?: number; // original t_peak before local refinement
}

export type Verdict = "good" | "borderline" | "bad" | "unmeasurable";

export interface TargetRange {
  min?: number;
  max?: number;
  ideal: number;
}

export interface AngleMeasurement {
  key: string; // e.g. "knee_angle", "elbow_top", "trunk_tibia"
  label: string; // human label, e.g. "Knee angle"
  value: number | null; // degrees (or ratio when unit === "ratio"); null if not measurable
  unit: "°" | "ratio";
  /** Landmark indices [A, B(vertex), C] used to draw the arc; omit for non-joint metrics. */
  points?: [number, number, number];
  reliable: boolean;
  target?: TargetRange;
  status: Verdict;
  deviation: number; // distance outside [min,max] (0 when inside)
  ruleId?: string;
  note?: string; // e.g. "Not measurable from this angle — film from the side"
  /** Which way a two-sided fault goes, e.g. "sag" | "pike" for the push-up body line, "drop" | "crane" for the head. */
  variant?: string;
}

export interface RuleViolation {
  ruleId: string;
  label: string;
  angleKey: string;
  actual: number;
  target: TargetRange;
  deviation: number;
  severity: number; // 1–5
  cue: string; // static coaching cue (used when the LLM is unavailable)
  basis: "literature" | "heuristic";
  citation?: string;
  /** Direction of a two-sided fault (same as AngleMeasurement.variant); label and cue already say it in words. */
  variant?: string;
}

export interface AngleReport {
  exercise: ExerciseId;
  view: View;
  side: Side;
  angles: AngleMeasurement[];
  violations: RuleViolation[]; // sorted most severe first
  score: number; // 0–100, code-computed
  grade: "A" | "B" | "C" | "D";
}

export interface VerifyReport {
  angles: AngleMeasurement[]; // measured on the AFTER image, same keys as the before report
  primaryKey: string;
  primaryBefore: number | null;
  primaryAfter: number | null;
  passed: boolean; // primary metric within target (or within 10° of it)
  identityDrift: number; // 0–1 relative change in torso length / shoulder width
  attempts: number;
}

/** Compact keypoint sent to the coach LLM. Pixel coords. */
export interface CompactKeypoint {
  i: number;
  name: string;
  x: number;
  y: number;
  v: number;
}

export type Stage =
  | "idle"
  | "probing"
  | "sampling"
  | "scanning"
  | "picking"
  | "refining"
  | "posing"
  | "coaching"
  | "correcting"
  | "verifying"
  | "done"
  | "error";

export type ErrorCode =
  | "unsupported_codec"
  | "file_too_large"
  | "video_too_long"
  | "bad_file_type"
  | "no_person"
  | "scan_failed"
  | "pose_model_failed"
  | "coach_failed"
  | "correct_failed"
  | "network"
  | "unknown";

export interface AppError {
  code: ErrorCode;
  message: string;
  stage?: Stage;
}

/** Edit sizes supported by the image edit endpoint. */
export type EditSize = "1024x1536" | "1536x1024" | "1024x1024";

/** Crop rectangle in source-frame pixels plus the output size it is rendered to. */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
  outW: number;
  outH: number;
  size: EditSize;
}
