// Static, UI-facing exercise metadata (labels, camera advice, image-edit hints).
// Biomechanical rules/targets live in rules.ts.
import type { DemoId, ExerciseId, View } from "../types";

export interface ExerciseInfo {
  id: ExerciseId;
  label: string; // "Pull-up"
  short: string; // chip label, "Pull-up"
  human: string; // used in prompts, "pull-up"
  bestView: Exclude<View, "unknown" | "angled">;
  cameraHint: string;
  /** Exercise-specific hint appended to the image-edit prompt. */
  editHint: string;
  /** Common faults the video model should look for (scan prompt). */
  faults: string;
}

export const EXERCISE_INFO: Record<ExerciseId, ExerciseInfo> = {
  squat: {
    id: "squat",
    label: "Back Squat",
    short: "Squat",
    human: "barbell back squat",
    bestView: "side",
    cameraHint: "Film from the side at hip height, whole body in frame.",
    editHint:
      "Hips at or slightly below knee height, torso angle roughly parallel to the shins, knees tracking over the toes, heels flat, neutral spine, bar over mid-foot.",
    faults: "insufficient depth, excessive forward torso lean, knees caving inward, heels lifting, butt wink",
  },
  bench_press: {
    id: "bench_press",
    label: "Bench Press",
    short: "Bench",
    human: "barbell bench press",
    bestView: "front",
    cameraHint: "Film from the foot end at about 45°, bar and both elbows visible.",
    editHint:
      "Upper arms about 60° from the torso (elbows tucked, not flared to 90°), forearms vertical under the bar, bar over the lower chest, shoulder blades pinched, feet planted.",
    faults: "elbows flared ~90°, bar touching too high (neck), wrists bent back, hips lifting off bench",
  },
  deadlift: {
    id: "deadlift",
    label: "Deadlift",
    short: "Deadlift",
    human: "barbell deadlift",
    bestView: "side",
    cameraHint: "Film from the side, bar and full body in frame.",
    editHint:
      "Neutral flat back from neck to hips, bar touching shins over mid-foot, shoulders slightly in front of the bar, arms straight.",
    faults: "rounded back, hips shooting up first, bar drifting away from shins, hyperextended lockout",
  },
  overhead_press: {
    id: "overhead_press",
    label: "Overhead Press",
    short: "OHP",
    human: "standing overhead press",
    bestView: "side",
    cameraHint: "Film from the side, bar and full body in frame.",
    editHint:
      "Ribs down with a neutral lower back, torso vertical, bar directly over the shoulders and mid-foot, elbows locked.",
    faults: "excessive lower-back arch / leaning back, bar path forward of head, incomplete lockout",
  },
  biceps_curl: {
    id: "biceps_curl",
    label: "Biceps Curl",
    short: "Curl",
    human: "biceps curl",
    bestView: "side",
    cameraHint: "Film from the side, upper body and elbows in frame.",
    editHint: "Upper arms pinned vertical at the sides, torso upright and still.",
    faults: "elbows drifting forward, torso swinging, partial range of motion",
  },
  pull_up: {
    id: "pull_up",
    label: "Pull-up",
    short: "Pull-up",
    human: "pull-up on a bar",
    bestView: "front",
    cameraHint: "Film from directly behind or in front, bar and whole body in frame.",
    editHint:
      "Top position: chin clearly above the bar, elbows fully bent and pulled down to the sides, shoulders level and down away from the ears, body still and vertical under the bar, legs straight and together (no kicking or swinging).",
    faults:
      "partial range of motion (chin not over the bar, no full dead hang), kipping / leg kick, body swinging, uneven pull (one side higher), shrugged shoulders",
  },
};

export const EXERCISE_ORDER: ExerciseId[] = ["pull_up", "squat", "bench_press", "deadlift", "overhead_press", "biceps_curl"];

export interface DemoClip {
  id: DemoId;
  exercise: ExerciseId;
  title: string;
  subtitle: string;
  video: string;
  poster: string;
}

export const DEMO_CLIPS: DemoClip[] = [
  {
    id: "pullup",
    exercise: "pull_up",
    title: "Pull-ups",
    subtitle: "Rear view · 15 s · real set",
    video: "/demo/pullup/video.mp4",
    poster: "/demo/pullup/poster.jpg",
  },
];

/** Demo fixture file names under /public/demo/<id>/ */
export const demoAsset = (id: DemoId, file: "scan.json" | "frame.jpg" | "pose.json" | "coach.json" | "after.jpg" | "after-pose.json" | "meta.json" | "rep.json") =>
  `/demo/${id}/${file}`;
