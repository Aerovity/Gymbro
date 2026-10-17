// Ghost (target) skeleton via 2D forward kinematics — the fallback "after" when the image edit fails.
import type { AngleReport, PoseResult, Pt } from "../types";
import { LM } from "../pose/landmarks";
import { METRICS } from "./compute";
import { angleAt, dist, mid, rootNearZero, toPx } from "./math";

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

// ───────────── push-up ghost (2D) ─────────────

const HAND_PTS = [LM.L_WRIST, LM.R_WRIST, LM.L_PINKY, LM.R_PINKY, LM.L_INDEX, LM.R_INDEX, LM.L_THUMB, LM.R_THUMB];
const TOES = [LM.L_FOOT, LM.R_FOOT];
const SIDES = {
  left: { shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST, hip: LM.L_HIP, knee: LM.L_KNEE, ankle: LM.L_ANKLE },
  right: { shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST, hip: LM.R_HIP, knee: LM.R_KNEE, ankle: LM.R_ANKLE },
} as const;

/** Hips and knees onto the shoulder→ankle line (both sides): a straight plank. */
export function straightenLine2D(pts: Pt[], w = 1) {
  for (const c of Object.values(SIDES)) {
    const S = pts[c.shoulder];
    const ux = pts[c.ankle].x - S.x;
    const uy = pts[c.ankle].y - S.y;
    const L2 = ux * ux + uy * uy;
    if (!(L2 > 1e-9)) continue;
    for (const i of [c.hip, c.knee]) {
      const p = pts[i];
      const t = ((p.x - S.x) * ux + (p.y - S.y) * uy) / L2;
      pts[i] = { x: p.x + (S.x + ux * t - p.x) * w, y: p.y + (S.y + uy * t - p.y) * w };
    }
  }
}

/** 2D two-bone IK: elbow a from S and b from W, on the side of `hint`. */
function solveElbow2D(S: Pt, W: Pt, hint: Pt, a: number, b: number): Pt {
  const d0 = dist(S, W);
  if (!(d0 > 1e-9)) return { ...hint };
  const ux = (W.x - S.x) / d0;
  const uy = (W.y - S.y) / d0;
  const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, d0));
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(a * a - x * x, 0));
  const rx = hint.x - S.x;
  const ry = hint.y - S.y;
  const along = rx * ux + ry * uy;
  let px_ = rx - ux * along;
  let py_ = ry - uy * along;
  let pl = Math.hypot(px_, py_);
  if (pl < 1e-9) {
    px_ = -uy;
    py_ = ux;
    pl = 1;
  }
  return { x: S.x + ux * x + (px_ / pl) * h, y: S.y + uy * x + (py_ / pl) * h };
}

/**
 * Side-view push-up arms to `target` elbow degrees: the body pivots about the toes with the hands
 * planted, then both elbows are re-solved with their segment lengths. `side` = the measured arm.
 */
export function pushArms2D(pts: Pt[], target: number, side: "left" | "right"): boolean {
  const near = SIDES[side];
  const a = dist(pts[near.shoulder], pts[near.elbow]);
  const b = dist(pts[near.elbow], pts[near.wrist]);
  if (!(a > 1e-6) || !(b > 1e-6)) return false;
  const rad = (Math.min(179, Math.max(20, target)) * Math.PI) / 180;
  const want = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(rad));
  const pivot = mid(pts[TOES[0]], pts[TOES[1]]);
  const S0 = pts[near.shoulder];
  const W = pts[near.wrist];
  if (!(dist(S0, pivot) > 1e-6)) return false;
  const phi = rootNearZero((x) => dist(rotateAbout(S0, pivot, x), W) - want, 0.6);
  const segs = Object.values(SIDES).map((c) => ({ c, a: dist(pts[c.shoulder], pts[c.elbow]), b: dist(pts[c.elbow], pts[c.wrist]) }));
  const keep = new Set<number>([...HAND_PTS, ...TOES]);
  for (let i = 0; i < pts.length; i++) if (!keep.has(i)) pts[i] = rotateAbout(pts[i], pivot, phi);
  for (const { c, a: sa, b: sb } of segs) {
    if (sa > 1e-6 && sb > 1e-6) pts[c.elbow] = solveElbow2D(pts[c.shoulder], pts[c.wrist], pts[c.elbow], sa, sb);
  }
  return true;
}

/** Front view: pull each elbow part-way toward its shoulder→wrist line (hands and shoulders fixed). */
function tuckElbows2D(pts: Pt[], w = 0.6) {
  for (const c of Object.values(SIDES)) {
    const S = pts[c.shoulder];
    const ux = pts[c.wrist].x - S.x;
    const uy = pts[c.wrist].y - S.y;
    const L2 = ux * ux + uy * uy;
    if (!(L2 > 1e-9)) continue;
    const E = pts[c.elbow];
    const t = ((E.x - S.x) * ux + (E.y - S.y) * uy) / L2;
    pts[c.elbow] = { x: E.x + (S.x + ux * t - E.x) * w, y: E.y + (S.y + uy * t - E.y) * w };
  }
}

/** The push-up target: straight plank, elbow depth / lockout with the hands planted, head in line, elbows tucked. */
function pushupGhost(pts: Pt[], report: AngleReport) {
  const find = (k: string) => report.violations.find((v) => v.angleKey === k);
  const side: "left" | "right" = report.side === "right" ? "right" : "left";
  if (find("body_line") || find("hip_offset")) straightenLine2D(pts);
  const arms = find("elbow_bottom") ?? find("elbow_top");
  if (arms && report.view !== "front") pushArms2D(pts, arms.target.ideal, side);
  const head = find("head_line");
  const hm = head && report.angles.find((a) => a.key === "head_line");
  if (head && hm?.points) setJointAngle(pts, hm.points, head.target.ideal);
  if (find("elbow_flare")) tuckElbows2D(pts);
}

/**
 * Target pose in pixels (all 33 points). For the most severe violation that is a joint angle, the distal
 * segment is rotated about its vertex to the rule's ideal; symmetric (front-view) metrics fix both sides.
 * Push-ups combine every flagged fix with the hands and toes kept on the floor (pushupGhost).
 */
export function ghostPose(pose: PoseResult, report: AngleReport): Pt[] {
  const pts = pose.landmarks.map((l) => toPx(l, pose.width, pose.height));
  if (report.exercise === "push_up") {
    pushupGhost(pts, report);
    return pts;
  }
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
