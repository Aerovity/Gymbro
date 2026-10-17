// Realistic pull-up mock data for /dev/gallery (and visual QA). Not used in production paths.
import type { AngleMeasurement, AngleReport, ChosenMoment, PoseResult, Pt, SampledFrame, ScanResult, Stage, TraceEntry, VerifyReport } from "@/lib/types";
import type { CoachReport } from "@/lib/schemas";
import { INITIAL_STEPS, type PipelineData, type StepId, type StepState } from "@/lib/store/pipeline";
import { buildPose, PULLUP_AFTER_PX, PULLUP_BEFORE_PX } from "@/components/shared/poseBuilder";

export const MOCK_W = 1024;
export const MOCK_H = 1536;
export const MOCK_BEFORE_IMG = "/dev/pullup-before.jpg";
export const MOCK_AFTER_IMG = "/dev/pullup-after.jpg";
export const MOCK_VIDEO = "/demo/pullup/video.mp4";
export const MOCK_DURATION = 15;

export const mockBeforePose: PoseResult = buildPose(MOCK_W, MOCK_H, PULLUP_BEFORE_PX);
export const mockAfterPose: PoseResult = buildPose(MOCK_W, MOCK_H, PULLUP_AFTER_PX);
/** Ghost points = the corrected pose in pixel space (what the integrator would pass as ghostPoints). */
export const mockGhostPoints: Pt[] = mockAfterPose.landmarks.map((l) => ({ x: l.x * MOCK_W, y: l.y * MOCK_H }));

export const mockFrames: SampledFrame[] = Array.from({ length: 24 }, (_, i) => ({
  t: Math.round(((i + 0.5) / 1.6) * 10) / 10,
  dataUrl: `/dev/frames/f${String(i + 1).padStart(2, "0")}.jpg`,
  width: 144,
  height: 256,
}));

export const mockAngles: AngleMeasurement[] = [
  { key: "elbow_top", label: "Elbow at top", value: 98, unit: "°", points: [12, 14, 16], reliable: true, target: { max: 75, ideal: 60 }, status: "bad", deviation: 23, ruleId: "pullup_top_elbow" },
  { key: "chin_clearance", label: "Chin over bar", value: -0.04, unit: "ratio", reliable: true, target: { min: 0.05, ideal: 0.15 }, status: "bad", deviation: 0.09, ruleId: "pullup_chin_clear" },
  { key: "knee_angle", label: "Knee angle", value: 128, unit: "°", points: [23, 25, 27], reliable: true, target: { min: 150, ideal: 175 }, status: "bad", deviation: 22, ruleId: "pullup_knee_kick" },
  { key: "body_sway", label: "Body sway", value: 0.27, unit: "ratio", reliable: true, target: { max: 0.25, ideal: 0 }, status: "borderline", deviation: 0.02, ruleId: "pullup_sway" },
  { key: "shoulder_tilt", label: "Shoulder level", value: 3, unit: "°", reliable: true, target: { max: 6, ideal: 0 }, status: "good", deviation: 0, ruleId: "pullup_shoulder_level" },
  { key: "elbow_asym", label: "Arm symmetry", value: 9, unit: "°", reliable: false, target: { max: 15, ideal: 0 }, status: "good", deviation: 0, ruleId: "pullup_elbow_sym", note: "Left wrist partly hidden by the head — ±8°" },
];

export const mockAngleReport: AngleReport = {
  exercise: "pull_up",
  view: "front",
  side: "both",
  angles: mockAngles,
  violations: [
    { ruleId: "pullup_top_elbow", label: "Elbow at top", angleKey: "elbow_top", actual: 98, target: { max: 75, ideal: 60 }, deviation: 23, severity: 4, cue: "Pull your elbows down to your ribs — chin over the bar.", basis: "heuristic" },
    { ruleId: "pullup_knee_kick", label: "Knee angle", angleKey: "knee_angle", actual: 128, target: { min: 150, ideal: 175 }, deviation: 22, severity: 3, cue: "Squeeze glutes, legs long — no kicking.", basis: "heuristic" },
    { ruleId: "pullup_chin_clear", label: "Chin over bar", angleKey: "chin_clearance", actual: -0.04, target: { min: 0.05, ideal: 0.15 }, deviation: 0.09, severity: 3, cue: "Drive the chin past the bar every rep.", basis: "heuristic" },
  ],
  score: 64,
  grade: "C",
};

export const mockVerify: VerifyReport = {
  angles: [
    { key: "elbow_top", label: "Elbow at top", value: 62, unit: "°", points: [12, 14, 16], reliable: true, target: { max: 75, ideal: 60 }, status: "good", deviation: 0 },
    { key: "chin_clearance", label: "Chin over bar", value: 0.13, unit: "ratio", reliable: true, target: { min: 0.05, ideal: 0.15 }, status: "good", deviation: 0 },
    { key: "knee_angle", label: "Knee angle", value: 171, unit: "°", points: [23, 25, 27], reliable: true, target: { min: 150, ideal: 175 }, status: "good", deviation: 0 },
    { key: "body_sway", label: "Body sway", value: 0.08, unit: "ratio", reliable: true, target: { max: 0.25, ideal: 0 }, status: "good", deviation: 0 },
    { key: "shoulder_tilt", label: "Shoulder level", value: 2, unit: "°", reliable: true, target: { max: 6, ideal: 0 }, status: "good", deviation: 0 },
    { key: "elbow_asym", label: "Arm symmetry", value: 5, unit: "°", reliable: true, target: { max: 15, ideal: 0 }, status: "good", deviation: 0 },
  ],
  primaryKey: "elbow_top",
  primaryBefore: 98,
  primaryAfter: 62,
  passed: true,
  identityDrift: 0.04,
  attempts: 1,
};

export const mockCoach: CoachReport = {
  spoken_summary:
    "Rep two stalled short of the bar. Your elbows stopped at 98 degrees and your chin never cleared, so your knees bent to 128 degrees to kick you the rest of the way. Pull your elbows down to your ribs, keep your legs long, and drive your chin past the bar on every rep.",
  headline: "Chin never cleared the bar",
  primary_fault: {
    id: "partial_rom_top",
    title: "Partial range at the top",
    explanation: "The pull stops with the elbows at 98° — about 23° short of a full top position — so the chin stays level with the bar.",
    body_part: "elbows",
    severity: 4,
  },
  secondary_faults: [{ title: "Knee kick", explanation: "Knees bend to 128° to generate momentum instead of pulling with the lats." }],
  angle_feedback: [
    { angle_key: "elbow_top", actual_deg: 98, target_min_deg: 0, target_max_deg: 75, target_ideal_deg: 60, verdict: "bad", comment: "Finish the pull — elbows to the ribs." },
    { angle_key: "knee_angle", actual_deg: 128, target_min_deg: 150, target_max_deg: 180, target_ideal_deg: 175, verdict: "bad", comment: "Legs long and quiet." },
    { angle_key: "shoulder_tilt", actual_deg: 3, target_min_deg: 0, target_max_deg: 6, target_ideal_deg: 0, verdict: "good", comment: "Even pull, nice." },
  ],
  cues: ["Elbows to your ribs", "Chin past the bar", "Legs long, glutes tight", "Own a 1 s pause up top"],
  drill: { name: "Eccentric pull-ups", prescription: "3 × 4 reps · 5 s lowering", why: "Builds strength exactly where you stall: the top third of the pull." },
  corrected_pose: {
    description: "Chin clearly above the bar, elbows pulled down beside the ribs, shoulders depressed, legs straight and together.",
    joint_targets: [
      { angle_key: "elbow_top", target_deg: 60 },
      { angle_key: "knee_angle", target_deg: 175 },
    ],
  },
  safety_note: "Stop the set if you feel sharp elbow or shoulder pain — switch to band-assisted reps.",
  form_score_adjustment: -4,
};

const RAW_COSMOS = `<think>
The lifter is filmed from behind on a pull-up bar. Six reps. Rep 2 (~0:07) stops with the head level with the bar; elbows remain partly extended. Knees flex during rep 1 and rep 2 to assist. Rep 4 shows some swing.
</think>
{"exercise":"pull_up","view":"front","rep_count":6,"events":[{"t_start":3.6,"t_peak":4.2,"t_end":4.6,"rep_index":1,"issue":"knee kick","body_part":"knees","severity":3,"confidence":0.78,"description":"Knees bend sharply to drive the body upward."},{"t_start":6.6,"t_peak":7.2,"t_end":7.6,"rep_index":2,"issue":"partial range at top","body_part":"elbows","severity":4,"confidence":0.86,"description":"Chin does not clear the bar; elbows stay partly extended at the top."},{"t_start":11.4,"t_peak":12.0,"t_end":12.6,"rep_index":4,"issue":"body swing","body_part":"core","severity":2,"confidence":0.64,"description":"Torso swings forward and back between reps."}],"overall":"Strong set overall; finish each rep with the chin over the bar and keep the legs quiet."}`;

export const mockTrace: TraceEntry[] = [
  { step: "probe", provider: "browser", ok: true, ms: 142, detail: "720×1280 · 15.0 s · H.264" },
  { step: "sample", provider: "browser", ok: true, ms: 1830, detail: "24 frames @ 1.6 fps · 2.1 MB" },
  { step: "scan", provider: "cosmos", model: "nvidia/cosmos-reason2-8b", ok: true, ms: 6420, detail: "3 events · 6 reps" },
  { step: "refine", provider: "mediapipe", model: "pose_landmarker_lite", ok: true, ms: 910, detail: "refined 0:07.2 → 0:07.0 (min mean elbow angle)" },
  { step: "pose", provider: "mediapipe", model: "pose_landmarker_full", ok: true, ms: 380, detail: "33 landmarks · view front" },
  { step: "coach", provider: "openai", model: "gpt-6.1-sol", ok: true, ms: 4120, detail: "streamed 412 tokens" },
  { step: "correct", provider: "openai", model: "gpt-image-2.5-flare", ok: true, ms: 17800, detail: "1024×1536 · attempt 1" },
  { step: "verify", provider: "mediapipe", ok: true, ms: 290, detail: "elbow_top 98° → 62° ✓" },
];

export const mockScan: ScanResult = {
  provider: "cosmos",
  model: "nvidia/cosmos-reason2-8b",
  exercise: "pull_up",
  view: "front",
  repCount: 6,
  events: [
    { t_start: 3.6, t_peak: 4.2, t_end: 4.6, rep_index: 1, issue: "Knee kick", body_part: "knees", severity: 3, confidence: 0.78, description: "Knees bend sharply to drive the body upward." },
    { t_start: 6.6, t_peak: 7.2, t_end: 7.6, rep_index: 2, issue: "Partial range at top", body_part: "elbows", severity: 4, confidence: 0.86, description: "Chin does not clear the bar; elbows stay partly extended at the top." },
    { t_start: 11.4, t_peak: 12.0, t_end: 12.6, rep_index: 4, issue: "Body swing", body_part: "core", severity: 2, confidence: 0.64, description: "Torso swings forward and back between reps." },
  ],
  overall: "Strong set overall; finish each rep with the chin over the bar and keep the legs quiet.",
  raw: RAW_COSMOS,
  trace: [{ step: "scan", provider: "cosmos", model: "nvidia/cosmos-reason2-8b", ok: true, ms: 6420 }],
};

export const mockMoment: ChosenMoment = { t: 7.0, source: "cosmos+pose-refine", event: mockScan.events[1], refinedFrom: 7.2 };

// ───────────── Stage builder ─────────────

const ORDER: StepId[] = ["upload", "scan", "found", "pose", "coach"];
const ACTIVE_AT: Record<Stage, number> = {
  idle: -1, probing: 0, sampling: 0, scanning: 1, picking: 2, refining: 2, posing: 3, coaching: 4, correcting: 5, verifying: 5, done: 5, error: 1,
};
const DONE: Record<StepId, Partial<StepState>> = {
  upload: { label: "15.0 s · 720×1280", ms: 1972 },
  scan: { label: "6 reps · 3 moments flagged", ms: 6420, provider: "NVIDIA Cosmos" },
  found: { label: "Found bad rep at 0:07", ms: 910 },
  pose: { label: "Front view · 6 angles", ms: 380 },
  coach: { label: "Coaching ready", ms: 4120 },
};
const ACTIVE: Partial<Record<StepId, string>> = {
  scan: "NVIDIA video AI is watching every rep",
};

export type MockVariant = "default" | "aiGenerating" | "aiFailed" | "aiDone" | "coachFallback" | "scanFallback" | "demo" | "landscape";

export function mockSteps(stage: Stage, variant: MockVariant = "default"): StepState[] {
  const a = ACTIVE_AT[stage];
  return INITIAL_STEPS.map((s, i) => {
    const id = ORDER[i];
    if (i < a) {
      const base: StepState = { ...s, ...DONE[id], status: "done" };
      if (variant === "scanFallback" && id === "scan") return { ...base, status: "fallback", provider: "GPT vision", note: "NVIDIA video model timed out — GPT vision scanned instead", label: "6 reps · 2 moments flagged" };
      if (variant === "coachFallback" && id === "coach") return { ...base, status: "fallback", note: "AI coach unavailable — rule-based coaching", label: "Rule-based coaching" };
      if (variant === "demo") return { ...base, provider: id === "scan" ? "Cached" : base.provider };
      return base;
    }
    if (i === a) return { ...s, status: "active", label: ACTIVE[id] ?? s.label };
    return { ...s };
  });
}

/** PipelineData snapshot for a given stage. */
export function mockPipeline(stage: Stage, variant: MockVariant = "default"): PipelineData {
  const a = ACTIVE_AT[stage];
  const done = a >= 5;
  const framesN = stage === "sampling" ? 15 : a >= 1 ? 24 : 0;
  const demo = variant === "demo";
  const withAfter = done && (variant === "aiDone" || demo);
  const d: PipelineData = {
    stage,
    steps: mockSteps(stage, variant),
    startedAt: Date.now() - 20000,
    exercise: demo ? "pull_up" : "auto",
    resolvedExercise: a >= 2 ? "pull_up" : undefined,
    detected: a >= 2 ? { exercise: "pull_up", confidence: 0.92, reason: "hanging from a bar, body vertical", source: demo ? "demo" : "video-model" } : undefined,
    demoId: demo ? "pullup" : undefined,
    demo,
    videoUrl: stage === "idle" ? undefined : MOCK_VIDEO,
    meta: stage === "idle" ? undefined : { name: "pullups.mp4", size: 3_420_634, mime: "video/mp4", duration: MOCK_DURATION, width: 720, height: 1280, orientation: "portrait" },
    frames: mockFrames.slice(0, framesN),
    scan: a >= 2 ? (variant === "scanFallback" ? { ...mockScan, provider: "gpt-fallback", model: "gpt-6.1-sol (contact sheet)" } : demo ? { ...mockScan, provider: "demo" } : mockScan) : undefined,
    moment: a >= 3 || stage === "refining" ? mockMoment : undefined,
    beforeImage: a >= 3 ? MOCK_BEFORE_IMG : undefined,
    beforePose: a >= 3 ? mockBeforePose : undefined,
    angles: a >= 4 ? mockAngleReport : undefined,
    coachText: stage === "coaching" ? mockCoach.spoken_summary.slice(0, 168) : done ? mockCoach.spoken_summary : "",
    coach: done ? mockCoach : undefined,
    coachFallback: variant === "coachFallback",
    afterImage: withAfter ? MOCK_AFTER_IMG : undefined,
    afterPose: withAfter ? mockAfterPose : undefined,
    afterFailed: false,
    aiPhoto: !done ? "idle" : withAfter ? "done" : variant === "aiGenerating" ? "generating" : variant === "aiFailed" ? "failed" : "idle",
    aiPhotoError: variant === "aiFailed" ? "The image model timed out after 60 s." : undefined,
    verify: withAfter ? mockVerify : undefined,
    score: done ? 60 : undefined,
    trace: mockTrace.slice(0, done ? (withAfter ? 8 : 6) : Math.max(0, a + 1)),
    showSkeleton: true,
    voiceOn: false,
  };
  if (stage === "error") {
    d.error = { code: "scan_failed", message: "All video models failed to respond (Cosmos timeout, Nemotron 503, GPT vision 429).", stage: "scanning" };
    d.steps = mockSteps("scanning").map((s) => (s.id === "scan" ? { ...s, status: "failed", label: "Video scan failed", note: "every video model and fallback failed" } : s));
    d.moment = undefined;
    d.beforeImage = undefined;
    d.beforePose = undefined;
    d.angles = undefined;
    d.scan = undefined;
    d.coach = undefined;
    d.coachText = "";
    d.score = undefined;
    d.detected = undefined;
    d.frames = mockFrames;
  }
  if (variant === "landscape" && d.meta) {
    // Push-ups are usually filmed landscape: exercise the landscape-aware layout.
    d.meta = { ...d.meta, width: 1280, height: 720, orientation: "landscape" };
  }
  if (variant === "coachFallback" && d.coach) {
    d.coach = { ...mockCoach, headline: "Finish the pull: elbows to ribs", spoken_summary: "Elbow at top measured 98°, target ≤75°. Pull your elbows down to your ribs — chin over the bar. Knee angle measured 128°, target ≥150°. Squeeze glutes, legs long — no kicking.", form_score_adjustment: 0 };
    d.coachText = d.coach.spoken_summary;
    d.score = 64;
  }
  return d;
}
