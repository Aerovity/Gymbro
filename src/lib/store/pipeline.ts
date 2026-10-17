// Pipeline state machine store (Zustand).
// NOTE: the state SHAPE below is the contract consumed by UI components (via props).
// Orchestration (start/retry) is implemented in hooks/usePipeline.ts by the integrator.
import { create } from "zustand";
import type {
  AngleReport,
  AppError,
  ChosenMoment,
  CropBox,
  DemoId,
  ExerciseChoice,
  ExerciseId,
  PoseResult,
  SampledFrame,
  ScanResult,
  Stage,
  TraceEntry,
  VerifyReport,
  VideoMeta,
} from "../types";
import type { CoachReport } from "../schemas";
import type { RepFrame } from "../pose3d/skeleton3d";

export type StepStatus = "pending" | "active" | "done" | "failed" | "fallback" | "skipped";

/** The 5 user-visible analysis steps (the AI photo is an optional, separate action). */
export type StepId = "upload" | "scan" | "found" | "pose" | "coach";

/** Optional "show me as an AI photo" action (GPT Image edit → re-measure). */
export type AiPhotoState = "idle" | "generating" | "verifying" | "done" | "failed";

/** How the exercise was decided. */
export interface DetectedExercise {
  exercise: ExerciseId;
  confidence: number; // 0–1
  reason: string; // short human text, e.g. "body horizontal, hands on the floor"
  source: "user" | "video-model" | "pose" | "demo";
}

export interface StepState {
  id: StepId;
  status: StepStatus;
  label: string; // live label, e.g. "Found bad rep at 0:07"
  ms?: number;
  provider?: string; // badge text, e.g. "NVIDIA Cosmos", "GPT vision", "cached"
  note?: string; // e.g. "fell back to GPT vision"
}

export interface PipelineData {
  stage: Stage;
  steps: StepState[];
  startedAt?: number;
  exercise: ExerciseChoice;
  resolvedExercise?: ExerciseId;
  detected?: DetectedExercise;
  demoId?: DemoId;
  demo: boolean;
  file?: File;
  videoUrl?: string;
  meta?: VideoMeta;
  frames: SampledFrame[]; // scan thumbnails (burned timestamps), streamed in during sampling
  scan?: ScanResult;
  moment?: ChosenMoment;
  crop?: CropBox;
  beforeImage?: string; // data URL / URL of the canonical cropped "before" image
  beforePose?: PoseResult; // landmarks in beforeImage space
  angles?: AngleReport;
  coachText: string; // live streamed spoken_summary
  coach?: CoachReport;
  coachFallback: boolean; // true when coach came from static rules
  afterImage?: string;
  afterPose?: PoseResult;
  /** 3D world-landmark sequence around the moment (animated mannequins). */
  repFrames?: RepFrame[];
  afterFailed: boolean; // image edit failed → ghost skeleton fallback
  aiPhoto: AiPhotoState;
  aiPhotoError?: string;
  verify?: VerifyReport;
  score?: number; // final shown score (code score + coach adjustment, clamped)
  trace: TraceEntry[];
  error?: AppError;
  showSkeleton: boolean;
  voiceOn: boolean;
}

export interface PipelineActions {
  set: (patch: Partial<PipelineData>) => void;
  setStep: (id: StepId, patch: Partial<StepState>) => void;
  addTrace: (e: TraceEntry) => void;
  reset: () => void;
  toggleSkeleton: () => void;
  toggleVoice: () => void;
}

export const INITIAL_STEPS: StepState[] = [
  { id: "upload", status: "pending", label: "Reading your video" },
  { id: "scan", status: "pending", label: "Watching your set" },
  { id: "found", status: "pending", label: "Finding the rep to fix" },
  { id: "pose", status: "pending", label: "Measuring your joints" },
  { id: "coach", status: "pending", label: "Writing your coaching" },
];

export const initialPipelineData = (): PipelineData => ({
  stage: "idle",
  steps: INITIAL_STEPS.map((s) => ({ ...s })),
  exercise: "auto",
  demo: false,
  frames: [],
  coachText: "",
  coachFallback: false,
  afterFailed: false,
  aiPhoto: "idle",
  trace: [],
  showSkeleton: true,
  voiceOn: false,
});

export type PipelineStore = PipelineData & PipelineActions;

export const usePipelineStore = create<PipelineStore>((set) => ({
  ...initialPipelineData(),
  set: (patch) => set(patch),
  setStep: (id, patch) =>
    set((s) => ({ steps: s.steps.map((st) => (st.id === id ? { ...st, ...patch } : st)) })),
  addTrace: (e) => set((s) => ({ trace: [...s.trace, e] })),
  reset: () =>
    set((s) => {
      if (s.videoUrl?.startsWith("blob:")) URL.revokeObjectURL(s.videoUrl);
      // Zustand merges, so optional fields absent from the initial data (beforeImage, moment, scan…)
      // would survive a reset and flash the previous run. Clear every data key explicitly.
      const base = initialPipelineData();
      const cleared: Record<string, undefined> = {};
      for (const k of Object.keys(s)) {
        if (typeof (s as unknown as Record<string, unknown>)[k] !== "function" && !(k in base)) cleared[k] = undefined;
      }
      return { ...cleared, ...base, showSkeleton: s.showSkeleton, voiceOn: s.voiceOn };
    }),
  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),
  toggleVoice: () => set((s) => ({ voiceOn: !s.voiceOn })),
}));
