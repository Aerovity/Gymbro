// Build a full 33-landmark PoseResult from a sparse map of pixel points (mock / hero data).
import type { Landmark, PoseResult } from "@/lib/types";

export type PxMap = Partial<Record<number, [number, number, number?]>>;

export function buildPose(W: number, H: number, px: PxMap): PoseResult {
  const get = (i: number): [number, number, number] => {
    const p = px[i];
    if (p) return [p[0], p[1], p[2] ?? 0.95];
    // derive face points from nose / hands from wrists when absent
    const nose = px[0] ?? [W / 2, H / 4];
    if (i >= 1 && i <= 6) return [nose[0] + (i <= 3 ? -1 : 1) * (8 + ((i - 1) % 3) * 8), nose[1] - 12, 0.3];
    if (i === 9 || i === 10) return [nose[0] + (i === 9 ? -9 : 9), nose[1] + 16, 0.3];
    if (i >= 17 && i <= 22) {
      const w = px[i % 2 === 1 ? 15 : 16] ?? [W / 2, H / 2];
      const k = Math.floor((i - 17) / 2);
      return [w[0] + (k - 1) * 8, w[1] - 18 - k * 4, (w[2] ?? 0.9) * 0.85];
    }
    return [W / 2, H / 2, 0.1];
  };
  const landmarks: Landmark[] = Array.from({ length: 33 }, (_, i) => {
    const [x, y, v] = get(i);
    return { x: x / W, y: y / H, z: 0, visibility: v };
  });
  const worldLandmarks: Landmark[] = landmarks.map((l) => ({ x: (l.x - 0.5) * 1.7, y: (l.y - 0.5) * 1.7, z: 0, visibility: l.visibility }));
  return { landmarks, worldLandmarks, width: W, height: H };
}

/** Before crop (1024×1536): lifter stalled near the top of a pull-up, seen from behind, knees kicking. */
export const PULLUP_BEFORE_PX: PxMap = {
  0: [452, 330, 0.55], 7: [414, 322, 0.85], 8: [496, 318, 0.85],
  11: [372, 404, 0.98], 12: [592, 394, 0.98],
  13: [344, 506, 0.9], 14: [661, 477, 0.95],
  15: [398, 338, 0.72], 16: [621, 334, 0.92],
  23: [420, 712, 0.95], 24: [578, 702, 0.95],
  25: [452, 1000, 0.93], 26: [566, 990, 0.93],
  27: [494, 1250, 0.9], 28: [566, 1278, 0.9],
  29: [486, 1284, 0.85], 30: [552, 1312, 0.85],
  31: [522, 1330, 0.85], 32: [600, 1336, 0.85],
};

/** After (1024×1536): chin over the bar, elbows pulled to the ribs, legs long. */
export const PULLUP_AFTER_PX: PxMap = {
  0: [470, 262, 0.6], 7: [430, 250, 0.85], 8: [510, 250, 0.85],
  11: [380, 330, 0.98], 12: [610, 320, 0.98],
  13: [344, 450, 0.93], 14: [680, 450, 0.93],
  15: [410, 368, 0.8], 16: [600, 360, 0.8],
  23: [440, 640, 0.95], 24: [590, 636, 0.95],
  25: [490, 900, 0.93], 26: [580, 896, 0.93],
  27: [530, 1090, 0.9], 28: [590, 1100, 0.9],
  29: [524, 1120, 0.85], 30: [584, 1130, 0.85],
  31: [560, 1160, 0.85], 32: [620, 1170, 0.85],
};
