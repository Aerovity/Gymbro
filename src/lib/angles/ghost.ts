// Ghost (target) skeleton via 2D forward kinematics — the fallback "after" when the image edit fails.
import type { AngleReport, PoseResult, Pt } from "../types";
import { LM } from "../pose/landmarks";
import { METRICS } from "./compute";
import { angleAt, toPx } from "./math";

const HEAD = [LM.NOSE, 1, 2, 3, 4, 5, 6, LM.L_EAR, LM.R_EAR, LM.MOUTH_L, LM.MOUTH_R];

/** Kinematic children: rotating a joint carries everything listed under it. */
const CHILDREN: Record<number, number[]> = {
  [LM.L_SHOULDER]: [LM.L_ELBOW, ...HEAD],
  [LM.R_SHOULDER]: [LM.R_ELBOW, ...HEAD],
  [LM.L_ELBOW]: [LM.L_WRIST],
  [LM.R_ELBOW]: [LM.R_WRIST],
  [LM.L_WRIST]: [LM.L_PINKY, LM.L_INDEX, LM.L_THUMB],
  [LM.R_WRIST]: [LM.R_PINKY, LM.R_INDEX, LM.R_THUMB],
  [LM.L_HIP]: [LM.L_KNEE],
  [LM.R_HIP]: [LM.R_KNEE],
  [LM.L_KNEE]: [LM.L_ANKLE],
  [LM.R_KNEE]: [LM.R_ANKLE],
  [LM.L_ANKLE]: [LM.L_HEEL, LM.L_FOOT],
  [LM.R_ANKLE]: [LM.R_HEEL, LM.R_FOOT],
};

/** The subtree rooted at `i` (inclusive). Any head point moves the whole head. */
export function subtree(i: number): number[] {
  if (HEAD.includes(i)) return [...HEAD];
  const out = new Set<number>([i]);
  const stack = [i];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of CHILDREN[n] ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return [...out];
}

/** Mirror a landmark index left ↔ right (face/body pairs). */
export function mirrorIndex(i: number): number {
  if (i === LM.NOSE) return i;
  if (i >= 1 && i <= 6) return i <= 3 ? i + 3 : i - 3;
  return i % 2 === 1 ? i + 1 : i - 1;
}

function rotateAbout(p: Pt, c: Pt, rad: number): Pt {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Is `d` a kinematic descendant of `b` (and not on the proximal side)? */
const isChild = (b: number, d: number) => (CHILDREN[b] ?? []).includes(d);

/**
 * Rotate the distal segment of the joint [a, b, c] about vertex b so the interior angle becomes `target`,
 * carrying descendants along. Mutates `pts`. Returns false when the joint can't be posed.
 */
export function setJointAngle(pts: Pt[], [a, b, c]: [number, number, number], target: number): boolean {
  let prox = a;
  let dist = c;
  if (!isChild(b, c) && isChild(b, a)) {
    prox = c;
    dist = a;
  } else if (!isChild(b, c)) {
    return false;
  }
  const B = pts[b];
  const ba = { x: pts[prox].x - B.x, y: pts[prox].y - B.y };
  const bc = { x: pts[dist].x - B.x, y: pts[dist].y - B.y };
  if (angleAt(pts[prox], B, pts[dist]) === null) return false;
  const signed = Math.atan2(ba.x * bc.y - ba.y * bc.x, ba.x * bc.x + ba.y * bc.y);
  const dir = signed >= 0 ? 1 : -1;
  const goal = (dir * Math.max(0, Math.min(180, target)) * Math.PI) / 180;
  const delta = goal - signed;
  for (const i of subtree(dist)) pts[i] = rotateAbout(pts[i], B, delta);
  return true;
}

/**
 * Target pose in pixels (all 33 points). For the most severe violation that is a joint angle, the distal
 * segment is rotated about its vertex to the rule's ideal; symmetric (front-view) metrics fix both sides.
 */
export function ghostPose(pose: PoseResult, report: AngleReport): Pt[] {
  const pts = pose.landmarks.map((l) => toPx(l, pose.width, pose.height));
  const metrics = METRICS[report.exercise];
  for (const v of report.violations) {
    const m = report.angles.find((a) => a.key === v.angleKey);
    const def = metrics[v.angleKey];
    if (!m?.points || !def?.pointsMeaning) continue;
    const interior = def.pointsMeaning === "interior" ? v.target.ideal : 180 - v.target.ideal;
    const ok = setJointAngle(pts, m.points, interior);
    if (!ok) continue;
    if (def.mode === "both") {
      const mirrored = m.points.map(mirrorIndex) as [number, number, number];
      setJointAngle(pts, mirrored, interior);
    }
    break;
  }
  return pts;
}
