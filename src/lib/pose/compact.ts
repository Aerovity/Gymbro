// Compact keypoints for the coach LLM: drawn joints only, pixel coords rounded.
import type { CompactKeypoint, PoseResult } from "../types";
import { DRAWN_JOINTS, LANDMARK_NAMES } from "./landmarks";

export function compactKeypoints(pose: PoseResult): CompactKeypoint[] {
  return DRAWN_JOINTS.flatMap((i) => {
    const l = pose.landmarks[i];
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return [];
    return [
      {
        i,
        name: LANDMARK_NAMES[i],
        x: Math.round(l.x * pose.width),
        y: Math.round(l.y * pose.height),
        v: Math.round((Number.isFinite(l.visibility) ? l.visibility : 0) * 100) / 100,
      },
    ];
  });
}
