// Deterministic synthetic push-up rep for checking the 3D replay without a real clip (dev only).
// 25 frames of 33 MediaPipe WORLD landmarks (metres, hip-centred, y down, z toward the camera
// negative). Filmed from the side: the body lies along the image x axis (head → +x) with the
// right side toward the camera. Plank → bottom → plank; the hips sag to ~15° at the bottom.
import type { AngleReport, ExerciseId, Landmark } from "@/lib/types";
import { LM } from "@/lib/pose/landmarks";
import { angle3, type RepFrame, type V3 } from "@/lib/pose3d/skeleton3d";

export const PUSHUP_FRAMES = 25;
export const PUSHUP_T0 = 2;
export const PUSHUP_FPS = 12;
/** Time of the bottom of the rep (deepest sag). */
export const PUSHUP_T_BOTTOM = PUSHUP_T0 + (PUSHUP_FRAMES - 1) / 2 / PUSHUP_FPS;

// Segment lengths (m).
const SHIN = 0.43;
const THIGH = 0.45;
const LEG = SHIN + THIGH;
const TORSO = 0.52;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;

// Fixed contacts (scene-like frame: x toward the head, y up, z toward the camera; the left side is −z).
const ANKLE_Y = 0.14;
const HAND: V3 = [1.24, 0.05, 0.3];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const withZ = (p: V3, z: number): V3 => [p[0], p[1], z];
const DEG = Math.PI / 180;

/** Two-bone IK: elbow between shoulder s and wrist w, bending towards `pole`. */
function elbow(s: V3, w: V3, pole: V3): V3 {
  const d = sub(w, s);
  const dist = Math.min(len(d), UPPER_ARM + FOREARM - 1e-4);
  const u = unit(d);
  const a = (UPPER_ARM ** 2 - FOREARM ** 2 + dist ** 2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, UPPER_ARM ** 2 - a ** 2));
  const v = unit(sub(pole, mul(u, dot(pole, u))));
  return add(add(s, mul(u, a)), mul(v, h));
}

/** One pose at phase p (0 = top plank, 1 = bottom). */
function poseAt(p: number): V3[] {
  const shoulderY = 0.6 - 0.32 * p;
  const sag = (3 + 12 * p) * DEG; // hip angle = 180° − sag
  const ankle: V3 = [0, ANKLE_Y, 0];
  const as = Math.sqrt(LEG ** 2 + TORSO ** 2 + 2 * LEG * TORSO * Math.cos(sag));
  const alpha = Math.asin((shoulderY - ANKLE_Y) / as);
  const beta = Math.asin((TORSO * Math.sin(sag)) / as);
  const legDir: V3 = [Math.cos(alpha - beta), Math.sin(alpha - beta), 0];
  const hip = add(ankle, mul(legDir, LEG));
  const knee = add(ankle, mul(legDir, SHIN));
  const shoulder = add(ankle, mul([Math.cos(alpha), Math.sin(alpha), 0], as));
  const torso = unit(sub(shoulder, hip));
  const chest: V3 = [torso[1], -torso[0], 0]; // the chest faces the floor

  const pts: V3[] = Array.from({ length: 33 }, () => [0, 0, 0] as V3);
  const side = (l: number, r: number, p3: V3, halfZ: number) => {
    pts[l] = withZ(p3, p3[2] - halfZ);
    pts[r] = withZ(p3, p3[2] + halfZ);
  };
  side(LM.L_SHOULDER, LM.R_SHOULDER, shoulder, 0.19);
  side(LM.L_HIP, LM.R_HIP, hip, 0.1);
  side(LM.L_KNEE, LM.R_KNEE, knee, 0.095);
  side(LM.L_ANKLE, LM.R_ANKLE, ankle, 0.09);
  side(LM.L_HEEL, LM.R_HEEL, add(ankle, [-0.06, 0.035, 0]), 0.09);
  side(LM.L_FOOT, LM.R_FOOT, [0.035, 0.005, 0], 0.1);

  for (const s of [-1, 1] as const) {
    const sh = s < 0 ? LM.L_SHOULDER : LM.R_SHOULDER;
    const w: V3 = [HAND[0], HAND[1], s * HAND[2]];
    const e = elbow(pts[sh], w, [-0.5, 0.7, s * 0.5]);
    const [el, wr, pi, ix, th] =
      s < 0 ? [LM.L_ELBOW, LM.L_WRIST, LM.L_PINKY, LM.L_INDEX, LM.L_THUMB] : [LM.R_ELBOW, LM.R_WRIST, LM.R_PINKY, LM.R_INDEX, LM.R_THUMB];
    pts[el] = e;
    pts[wr] = w;
    pts[ix] = add(w, [0.085, -0.035, 0]);
    pts[pi] = add(w, [0.07, -0.035, s * 0.035]);
    pts[th] = add(w, [0.045, -0.02, -s * 0.035]);
  }

  // Head: neutral neck, face toward the floor.
  const earMid = add(add(shoulder, mul(torso, 0.17)), mul(chest, -0.02));
  const nose = add(add(earMid, mul(torso, 0.04)), mul(chest, 0.1));
  side(LM.L_EAR, LM.R_EAR, earMid, 0.075);
  pts[LM.NOSE] = nose;
  const eye = add(add(nose, mul(torso, 0.025)), mul(chest, -0.03));
  side(LM.L_EYE_INNER, LM.R_EYE_INNER, eye, 0.015);
  side(LM.L_EYE, LM.R_EYE, eye, 0.032);
  side(LM.L_EYE_OUTER, LM.R_EYE_OUTER, add(eye, mul(chest, -0.01)), 0.045);
  side(LM.MOUTH_L, LM.MOUTH_R, add(add(nose, mul(torso, -0.035)), mul(chest, -0.01)), 0.025);
  return pts;
}

/** Scene-like points → MediaPipe world landmarks (hip-centred, y down, z toward the camera negative). */
function toWorld(pts: readonly V3[]): Landmark[] {
  const hip = mul(add(pts[LM.L_HIP], pts[LM.R_HIP]), 0.5);
  const r = (n: number) => Math.round(n * 10000) / 10000 || 0;
  return pts.map((p) => {
    const q = sub(p, hip);
    return { x: r(q[0]), y: r(-q[1]), z: r(-q[2]), visibility: 0.99 };
  });
}

/** The synthetic rep: top → bottom (sagging hips) → top. */
export function syntheticPushupRep(): RepFrame[] {
  return Array.from({ length: PUSHUP_FRAMES }, (_, i) => {
    const p = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (PUSHUP_FRAMES - 1));
    return { t: Math.round((PUSHUP_T0 + i / PUSHUP_FPS) * 1000) / 1000, world: toWorld(poseAt(p)) };
  });
}

/** A minimal measured report for the bottom frame: one body-line violation (hips sagging). */
export function syntheticPushupReport(exercise: ExerciseId, frames: readonly RepFrame[] = syntheticPushupRep()): AngleReport {
  const bottom = frames[Math.floor(frames.length / 2)].world.map((l) => [l.x, -l.y, -l.z] as V3);
  const bodyLine = Math.round(angle3(bottom[LM.R_SHOULDER], bottom[LM.R_HIP], bottom[LM.R_ANKLE]) ?? 165);
  const elbowBottom = Math.round(angle3(bottom[LM.R_SHOULDER], bottom[LM.R_ELBOW], bottom[LM.R_WRIST]) ?? 70);
  const target = { min: 165, ideal: 178 }; // rules.ts pushup_body_line
  return {
    exercise,
    view: "side",
    side: "right",
    angles: [
      {
        key: "body_line",
        label: "Body line",
        value: bodyLine,
        unit: "°",
        points: [LM.R_SHOULDER, LM.R_HIP, LM.R_ANKLE],
        reliable: true,
        target,
        status: "bad",
        deviation: target.min - bodyLine,
        ruleId: "pushup_body_line",
      },
      {
        key: "elbow_bottom",
        label: "Elbow angle at the bottom",
        value: elbowBottom,
        unit: "°",
        points: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
        reliable: true,
        target: { max: 90, ideal: 80 },
        status: "good",
        deviation: 0,
        ruleId: "pushup_depth",
      },
    ],
    violations: [
      {
        ruleId: "pushup_body_line",
        label: "Body line",
        angleKey: "body_line",
        actual: bodyLine,
        target,
        deviation: target.min - bodyLine,
        severity: 3,
        cue: "Squeeze your glutes and brace — one straight line from head to heels.",
        basis: "heuristic",
      },
    ],
    score: 71,
    grade: "C",
  };
}
