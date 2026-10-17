// Synthetic pose builders for unit tests. All inputs are PIXEL positions; output landmarks are normalised.
import type { Landmark, PoseResult, Pt } from "@/lib/types";
import { LM } from "@/lib/pose/landmarks";

/** [x, y] or [x, y, visibility] in pixels. */
export type PxSpec = [number, number] | [number, number, number];

export interface MakePoseOptions {
  W?: number;
  H?: number;
  /** Default visibility for every landmark. */
  vis?: number;
  /** Explicit world landmarks [x, y, z] (metres). Defaults to pixels / 1000 around the centre, z = 0. */
  world?: Partial<Record<number, [number, number, number]>>;
  /** Leave worldLandmarks empty. */
  noWorld?: boolean;
}

const deg2rad = (d: number) => (d * Math.PI) / 180;

/** Point `len` px from `p` in direction `deg` measured clockwise from straight up (0 = up, 90 = right, 180 = down). */
export function seg(p: Pt, deg: number, len: number): Pt {
  return { x: p.x + Math.sin(deg2rad(deg)) * len, y: p.y - Math.cos(deg2rad(deg)) * len };
}

/** Direction (clockwise from up, degrees) of the vector p → q. */
export function dirOf(p: Pt, q: Pt): number {
  return (Math.atan2(q.x - p.x, -(q.y - p.y)) * 180) / Math.PI;
}

/** Point `len` from `vertex` such that the interior angle (ref, vertex, result) = `interior`; sign picks the side. */
export function armAt(vertex: Pt, ref: Pt, interior: number, len: number, sign: 1 | -1): Pt {
  return seg(vertex, dirOf(vertex, ref) + sign * interior, len);
}

/** A neutral standing front-view skeleton for a W×H frame (pixels). */
export function baseFront(W = 1000, H = 1000): Record<number, [number, number]> {
  const cx = W / 2;
  const u = H / 1000;
  const b: Record<number, [number, number]> = {};
  const put = (i: number, x: number, y: number) => (b[i] = [cx + x * u, y * u]);
  put(LM.NOSE, 0, 150);
  for (const [i, dx] of [[1, -10], [2, -15], [3, -20], [4, 10], [5, 15], [6, 20]] as const) put(i, dx, 140);
  put(LM.L_EAR, -30, 150);
  put(LM.R_EAR, 30, 150);
  put(LM.MOUTH_L, -8, 170);
  put(LM.MOUTH_R, 8, 170);
  put(LM.L_SHOULDER, -90, 250);
  put(LM.R_SHOULDER, 90, 250);
  put(LM.L_ELBOW, -100, 380);
  put(LM.R_ELBOW, 100, 380);
  put(LM.L_WRIST, -105, 500);
  put(LM.R_WRIST, 105, 500);
  for (const [i, x] of [[17, -110], [19, -105], [21, -100], [18, 110], [20, 105], [22, 100]] as const) put(i, x, 525);
  put(LM.L_HIP, -60, 520);
  put(LM.R_HIP, 60, 520);
  put(LM.L_KNEE, -62, 720);
  put(LM.R_KNEE, 62, 720);
  put(LM.L_ANKLE, -64, 920);
  put(LM.R_ANKLE, 64, 920);
  put(LM.L_HEEL, -66, 935);
  put(LM.R_HEEL, 66, 935);
  put(LM.L_FOOT, -80, 945);
  put(LM.R_FOOT, 80, 945);
  return b;
}

/** Build a PoseResult. Unspecified landmarks come from `baseFront`. */
export function makePose(points: Partial<Record<number, PxSpec | Pt>>, opts: MakePoseOptions = {}): PoseResult {
  const W = opts.W ?? 1000;
  const H = opts.H ?? 1000;
  const vis = opts.vis ?? 0.95;
  const base = baseFront(W, H);
  const landmarks: Landmark[] = [];
  const worldLandmarks: Landmark[] = [];
  for (let i = 0; i < 33; i++) {
    const p = points[i];
    let x: number, y: number, v: number;
    if (p && !Array.isArray(p)) {
      x = p.x;
      y = p.y;
      v = vis;
    } else if (p) {
      [x, y] = p;
      v = p[2] ?? vis;
    } else {
      [x, y] = base[i];
      v = vis;
    }
    landmarks.push({ x: x / W, y: y / H, z: 0, visibility: v });
    const w = opts.world?.[i];
    worldLandmarks.push(
      w ? { x: w[0], y: w[1], z: w[2], visibility: v } : { x: (x - W / 2) / 1000, y: (y - H / 2) / 1000, z: 0, visibility: v },
    );
  }
  return { landmarks, worldLandmarks: opts.noWorld ? [] : worldLandmarks, width: W, height: H };
}

/** Override visibility of some landmarks. */
export function withVisibility(pose: PoseResult, idx: number[], v: number): PoseResult {
  return {
    ...pose,
    landmarks: pose.landmarks.map((l, i) => (idx.includes(i) ? { ...l, visibility: v } : l)),
  };
}

export interface SquatSpec {
  knee: number; // interior knee angle
  tibia: number; // shin inclination from vertical (knee forward)
  torso: number; // torso lean from vertical (forward)
  heelLiftPx?: number;
  nearVis?: number;
  farVis?: number;
  side?: "left" | "right";
  W?: number;
  H?: number;
}

/** Side-view squat facing +x. The near side is `side` (default left); the far side is offset and dimmer. */
export function sideSquat(spec: SquatSpec): PoseResult {
  const W = spec.W ?? 1000;
  const H = spec.H ?? 1000;
  const ankle = { x: 420, y: 900 };
  const knee = seg(ankle, spec.tibia, 200);
  const hip = armAt(knee, ankle, spec.knee, 220, 1);
  const shoulder = seg(hip, spec.torso, 260);
  const ear = seg(shoulder, spec.torso, 70);
  const nose = { x: ear.x + 25, y: ear.y + 5 };
  const elbow = seg(shoulder, 200, 90);
  const wrist = seg(elbow, 20, 70);
  const heel = { x: 400, y: 915 - (spec.heelLiftPx ?? 0) };
  const foot = { x: 480, y: 915 };
  const near = spec.side ?? "left";
  const nv = spec.nearVis ?? 0.95;
  const fv = spec.farVis ?? 0.3;
  const pts: Partial<Record<number, PxSpec>> = {};
  const chain = (s: "left" | "right", dx: number, dy: number, v: number) => {
    const L = s === "left";
    const put = (i: number, p: Pt) => (pts[i] = [p.x + dx, p.y + dy, v]);
    put(L ? LM.L_SHOULDER : LM.R_SHOULDER, shoulder);
    put(L ? LM.L_ELBOW : LM.R_ELBOW, elbow);
    put(L ? LM.L_WRIST : LM.R_WRIST, wrist);
    put(L ? LM.L_HIP : LM.R_HIP, hip);
    put(L ? LM.L_KNEE : LM.R_KNEE, knee);
    put(L ? LM.L_ANKLE : LM.R_ANKLE, ankle);
    put(L ? LM.L_HEEL : LM.R_HEEL, heel);
    put(L ? LM.L_FOOT : LM.R_FOOT, foot);
    put(L ? LM.L_EAR : LM.R_EAR, ear);
  };
  chain(near, 0, 0, nv);
  chain(near === "left" ? "right" : "left", 6, -3, fv);
  pts[LM.NOSE] = [nose.x, nose.y, nv];
  return makePose(pts, { W, H });
}

export interface PullupSpec {
  elbowL: number;
  elbowR?: number;
  knee?: number; // interior knee angle (both legs)
  noseVis?: number;
  vis?: number;
  hipShiftX?: number; // sway: hips displaced horizontally (px)
  W?: number;
  H?: number;
}

/** Rear/front-view pull-up hanging from a bar at y = 200 (720×1280 portrait by default). */
export function pullUp(spec: PullupSpec): PoseResult {
  const W = spec.W ?? 720;
  const H = spec.H ?? 1280;
  const barY = 200;
  const cx = W / 2;
  const half = 90; // half shoulder width
  const grip = 90; // wrist outward offset from the shoulder
  const ua = 110;
  const fa = 100;
  const pts: Partial<Record<number, PxSpec>> = {};
  const v = spec.vis ?? 0.95;
  const sideArm = (s: "left" | "right", elbowDeg: number) => {
    const sign = s === "left" ? -1 : 1;
    const d = Math.sqrt(ua * ua + fa * fa - 2 * ua * fa * Math.cos((elbowDeg * Math.PI) / 180));
    const vert = Math.sqrt(Math.max(d * d - grip * grip, 1));
    const shoulder = { x: cx + sign * half, y: barY + vert };
    const wrist = { x: shoulder.x + sign * grip, y: barY };
    // Elbow: circle intersection, outer solution.
    const dx = wrist.x - shoulder.x;
    const dy = wrist.y - shoulder.y;
    const a = (ua * ua - fa * fa + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(ua * ua - a * a, 0));
    const mx = shoulder.x + (a * dx) / d;
    const my = shoulder.y + (a * dy) / d;
    const e1 = { x: mx + (h * dy) / d, y: my - (h * dx) / d };
    const e2 = { x: mx - (h * dy) / d, y: my + (h * dx) / d };
    const elbow = Math.abs(e1.x - cx) > Math.abs(e2.x - cx) ? e1 : e2;
    return { shoulder, wrist, elbow };
  };
  const L = sideArm("left", spec.elbowL);
  const R = sideArm("right", spec.elbowR ?? spec.elbowL);
  const shift = spec.hipShiftX ?? 0;
  const shY = (L.shoulder.y + R.shoulder.y) / 2;
  const hipY = shY + 250;
  const lHip = { x: cx - 60 + shift, y: hipY };
  const rHip = { x: cx + 60 + shift, y: hipY };
  const kneeAngle = spec.knee ?? 178;
  const legs = (hip: Pt) => {
    const knee = { x: hip.x, y: hip.y + 200 };
    const ankle = armAt(knee, hip, kneeAngle, 190, 1);
    return { knee, ankle };
  };
  const lLeg = legs(lHip);
  const rLeg = legs(rHip);
  const put = (i: number, p: Pt, vis = v) => (pts[i] = [p.x, p.y, vis]);
  put(LM.L_SHOULDER, L.shoulder);
  put(LM.R_SHOULDER, R.shoulder);
  put(LM.L_ELBOW, L.elbow);
  put(LM.R_ELBOW, R.elbow);
  put(LM.L_WRIST, L.wrist);
  put(LM.R_WRIST, R.wrist);
  for (const i of [LM.L_PINKY, LM.L_INDEX, LM.L_THUMB]) put(i, { x: L.wrist.x, y: L.wrist.y - 15 });
  for (const i of [LM.R_PINKY, LM.R_INDEX, LM.R_THUMB]) put(i, { x: R.wrist.x, y: R.wrist.y - 15 });
  put(LM.L_HIP, lHip);
  put(LM.R_HIP, rHip);
  put(LM.L_KNEE, lLeg.knee);
  put(LM.R_KNEE, rLeg.knee);
  put(LM.L_ANKLE, lLeg.ankle);
  put(LM.R_ANKLE, rLeg.ankle);
  put(LM.L_HEEL, { x: lLeg.ankle.x, y: lLeg.ankle.y + 12 });
  put(LM.R_HEEL, { x: rLeg.ankle.x, y: rLeg.ankle.y + 12 });
  put(LM.L_FOOT, { x: lLeg.ankle.x - 5, y: lLeg.ankle.y + 25 });
  put(LM.R_FOOT, { x: rLeg.ankle.x + 5, y: rLeg.ankle.y + 25 });
  const headY = shY - 90;
  const noseVis = spec.noseVis ?? v;
  put(LM.NOSE, { x: cx, y: headY }, noseVis);
  for (const i of [1, 2, 3, 4, 5, 6, LM.MOUTH_L, LM.MOUTH_R]) put(i, { x: cx + (i % 2 ? -10 : 10), y: headY - 5 }, noseVis);
  put(LM.L_EAR, { x: cx - 30, y: headY - 5 });
  put(LM.R_EAR, { x: cx + 30, y: headY - 5 });
  return makePose(pts, { W, H });
}

export interface BenchSpec {
  flareL: number;
  flareR?: number;
  W?: number;
  H?: number;
}

/** Front/foot-end view bench: elbows placed so angle(elbow, shoulder, hip) = flare; forearms vertical. */
export function benchFront(spec: BenchSpec): PoseResult {
  const W = spec.W ?? 1000;
  const H = spec.H ?? 1000;
  const lSh = { x: 400, y: 400 };
  const rSh = { x: 600, y: 400 };
  const lHip = { x: 440, y: 700 };
  const rHip = { x: 560, y: 700 };
  const lEl = armAt(lSh, lHip, spec.flareL, 130, 1);
  const rEl = armAt(rSh, rHip, spec.flareR ?? spec.flareL, 130, -1);
  const lWr = { x: lEl.x, y: lEl.y - 110 };
  const rWr = { x: rEl.x, y: rEl.y - 110 };
  return makePose(
    {
      [LM.L_SHOULDER]: [lSh.x, lSh.y],
      [LM.R_SHOULDER]: [rSh.x, rSh.y],
      [LM.L_HIP]: [lHip.x, lHip.y],
      [LM.R_HIP]: [rHip.x, rHip.y],
      [LM.L_ELBOW]: [lEl.x, lEl.y],
      [LM.R_ELBOW]: [rEl.x, rEl.y],
      [LM.L_WRIST]: [lWr.x, lWr.y],
      [LM.R_WRIST]: [rWr.x, rWr.y],
    },
    { W, H },
  );
}
