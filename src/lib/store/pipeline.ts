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

/** The 7 user-visible pipeline steps shown in the stepper. */
export type StepId = "upload" | "scan" | "found" | "pose" | "coach" | "correct" | "verify";

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
  { id: "upload", status: "pending", label: "Reading video" },
  { id: "scan", status: "pending", label: "Scanning video with NVIDIA AI" },
  { id: "found", status: "pending", label: "Finding the bad rep" },
  { id: "pose", status: "pending", label: "Mapping skeleton" },
  { id: "coach", status: "pending", label: "Coach analysing" },
  { id: "correct", status: "pending", label: "Generating corrected form" },
  { id: "verify", status: "pending", label: "Verifying the fix" },
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
      return { ...initialPipelineData(), showSkeleton: s.showSkeleton, voiceOn: s.voiceOn };
    }),
  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),
  toggleVoice: () => set((s) => ({ voiceOn: !s.voiceOn })),
}));
