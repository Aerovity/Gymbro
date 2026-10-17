// Identity-preserving image-edit prompt (spec §8.4).
import type { ExerciseId } from "@/lib/types";
import type { CoachReport } from "@/lib/schemas";
import { EXERCISE_INFO } from "@/lib/exercises/catalog";

export interface EditPromptInput {
  exercise: ExerciseId;
  correctedPose: CoachReport["corrected_pose"];
  primaryFault?: string;
  attempt?: 1 | 2;
  measuredMiss?: string;
}

const KEY_LABELS: Record<string, string> = {
  elbow_top: "elbow angle at the top",
  elbow_bottom: "elbow angle at the bottom",
  body_line: "shoulder–hip–ankle body line",
  hip_offset: "hip offset from the shoulder–ankle line",
  head_line: "ear–shoulder–hip head line",
  elbow_flare: "upper-arm angle from the torso",
  chin_clearance: "chin clearance above the hands",
  knee_angle: "knee angle",
  shoulder_tilt: "shoulder tilt from horizontal",
  elbow_asym: "left/right elbow difference",
  body_sway: "body sway",
  trunk_tibia: "torso vs shin angle",
  hip_angle: "hip angle",
  elbow_angle: "elbow angle",
};

export function angleKeyLabel(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Ratio metrics (no degree sign in the prompt). */
const RATIO_KEYS = new Set(["chin_clearance", "body_sway", "hip_offset", "hip_depth", "knee_ankle_width", "heel_lift", "bar_path", "wrist_over_shoulder"]);

export function buildEditPrompt(ctx: EditPromptInput): string {
  const info = EXERCISE_INFO[ctx.exercise];
  const targets = ctx.correctedPose.joint_targets
    .map((j) => `${angleKeyLabel(j.angle_key)} ≈ ${Math.round(j.target_deg * 100) / 100}${j.angle_key.includes("ratio") || RATIO_KEYS.has(j.angle_key) ? "" : "°"}; `)
    .join("");
  const contact = info.contact ?? "correct hand grip on any bar or weights, equipment resting in a physically plausible position";
  const lines = [
    `Edit this photo. It is a single frame of a real person performing a ${info.human} during a workout.`,
    "",
    "CHANGE ONLY the lifter's body position to show correct technique:",
    ctx.correctedPose.description,
  ];
  if (ctx.primaryFault) lines.push(`Fault to fix: ${ctx.primaryFault}.`);
  if (targets) lines.push(`Specific joint targets: ${targets.trim()}`);
  lines.push(info.editHint);
  if (ctx.attempt === 2 && ctx.measuredMiss) {
    lines.push(
      `IMPORTANT: a previous attempt did not change the pose enough — ${ctx.measuredMiss}. Make the corrected body position clearly and unmistakably match the targets above.`,
    );
  }
  lines.push(
    "",
    "KEEP EXACTLY THE SAME: the person's identity, face, hair, skin tone, body shape and size, clothing (colours, logos, fit), shoes, any equipment in the shot (bar, rack, bench, weights, mat), the background, camera position, focal length, framing, lighting and colour grade. Same moment in the same set — not a new photo.",
    `The result must look like an unedited photograph from the same camera: realistic anatomy, ${contact}, no extra limbs, no text, no arrows, no overlays, no watermarks.`,
  );
  return lines.join("\n");
}
