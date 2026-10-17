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

export interface PushupSpec {
  /** Interior elbow angle of the near arm. */
  elbow: number;
  /** Hip offset from the shoulder→ankle line in torso lengths: + = sag toward the floor, − = pike. */
  hipOffset?: number;
  /** Interior ear–shoulder–hip angle (default 172). */
  neck?: number;
  /** Which way the head bends when neck < 180: "drop" (toward the floor, default) or "crane". */
  head?: "drop" | "crane";
  /** Head toward +x (1, default) or −x (−1). */
  facing?: 1 | -1;
  nearVis?: number;
  farVis?: number;
  side?: "left" | "right";
  W?: number;
  H?: number;
}

/**
 * Side-view push-up filmed at floor level (1280×720 by default): hands planted under the shoulders
 * on the floor (y = 600), toes on the floor, body running along x. The far side is offset and dimmer.
 */
export function sidePushUp(spec: PushupSpec): PoseResult {
  const W = spec.W ?? 1280;
  const H = spec.H ?? 720;
  const f = spec.facing ?? 1;
  const floorY = 600;
  const ua = 150;
  const fa = 140;
  const T = 260; // shoulder–hip
  const wrist = { x: W / 2 + 210 * f, y: floorY };
  const d = Math.sqrt(ua * ua + fa * fa - 2 * ua * fa * Math.cos((spec.elbow * Math.PI) / 180));
  const shoulder = { x: wrist.x, y: wrist.y - d };
  // Elbow: circle intersection, the solution toward the feet (−f · x).
  const a = (ua * ua - fa * fa + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(ua * ua - a * a, 0));
  const mx = shoulder.x;
  const my = shoulder.y + a; // wrist is straight below the shoulder
  const elbow = { x: mx - f * h, y: my };
  const ankle = { x: wrist.x - 760 * f, y: floorY - 18 };
  const ux0 = ankle.x - shoulder.x;
  const uy0 = ankle.y - shoulder.y;
  const L = Math.hypot(ux0, uy0);
  const u = { x: ux0 / L, y: uy0 / L };
  let n = { x: -u.y, y: u.x };
  if (n.y < 0) n = { x: -n.x, y: -n.y };
  const off = (spec.hipOffset ?? 0) * T;
  const hip = { x: shoulder.x + u.x * T + n.x * off, y: shoulder.y + u.y * T + n.y * off };
  const knee = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 };
  const neck = spec.neck ?? 172;
  const earA = armAt(shoulder, hip, neck, 70, 1);
  const earB = armAt(shoulder, hip, neck, 70, -1);
  const drop = (spec.head ?? "drop") === "drop";
  const ear = (drop ? earA.y > earB.y : earA.y < earB.y) ? earA : earB;
  const nose = { x: ear.x + 18 * f, y: ear.y + 12 };
  const heel = { x: ankle.x - 22 * f, y: ankle.y - 12 };
  const foot = { x: ankle.x + 22 * f, y: floorY };
  const near = spec.side ?? "left";
  const nv = spec.nearVis ?? 0.95;
  const fv = spec.farVis ?? 0.3;
  const pts: Partial<Record<number, PxSpec>> = {};
  const chain = (s: "left" | "right", dx: number, dy: number, v: number) => {
    const Lf = s === "left";
    const put = (i: number, p: Pt) => (pts[i] = [p.x + dx, p.y + dy, v]);
    put(Lf ? LM.L_SHOULDER : LM.R_SHOULDER, shoulder);
    put(Lf ? LM.L_ELBOW : LM.R_ELBOW, elbow);
    put(Lf ? LM.L_WRIST : LM.R_WRIST, wrist);
    for (const i of Lf ? [LM.L_PINKY, LM.L_INDEX, LM.L_THUMB] : [LM.R_PINKY, LM.R_INDEX, LM.R_THUMB]) put(i, { x: wrist.x + 12 * f, y: wrist.y });
    put(Lf ? LM.L_HIP : LM.R_HIP, hip);
    put(Lf ? LM.L_KNEE : LM.R_KNEE, knee);
    put(Lf ? LM.L_ANKLE : LM.R_ANKLE, ankle);
    put(Lf ? LM.L_HEEL : LM.R_HEEL, heel);
    put(Lf ? LM.L_FOOT : LM.R_FOOT, foot);
    put(Lf ? LM.L_EAR : LM.R_EAR, ear);
  };
  chain(near, 0, 0, nv);
  chain(near === "left" ? "right" : "left", 5, -3, fv);
  pts[LM.NOSE] = [nose.x, nose.y, nv];
  for (const i of [1, 2, 3, 4, 5, 6, LM.MOUTH_L, LM.MOUTH_R]) pts[i] = [nose.x - 4 * f, nose.y - 6, nv];
  return makePose(pts, { W, H });
}

export interface FrontPushupSpec {
  /** 3D angle elbow–shoulder–hip (upper arm from torso) on both arms. */
  flare: number;
  W?: number;
  H?: number;
}

/**
 * Push-up filmed from in front of the head at floor level: torso foreshortened (pointing at the camera),
 * hands on the floor below the shoulders. World landmarks are 3D (y down, z away from the camera) so
 * the flare is measurable.
 */
export function frontPushUp(spec: FrontPushupSpec): PoseResult {
  const W = spec.W ?? 1280;
  const H = spec.H ?? 720;
  const cx = W / 2;
  const v3 = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const norm = (p: [number, number, number]) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return v3(p[0] / l, p[1] / l, p[2] / l);
  };
  const world: Partial<Record<number, [number, number, number]>> = {};
  const pts: Partial<Record<number, PxSpec>> = {};
  for (const s of [-1, 1] as const) {
    const L = s === -1;
    const sh = v3(0.2 * s, 0, 0);
    const hip = v3(0.12 * s, -0.02, 0.5);
    const t = norm(v3(hip[0] - sh[0], hip[1] - sh[1], hip[2] - sh[2]));
    // Outward + up, made perpendicular to the torso.
    const q = v3(s, -0.6, 0);
    const qt = q[0] * t[0] + q[1] * t[1] + q[2] * t[2];
    const p = norm(v3(q[0] - qt * t[0], q[1] - qt * t[1], q[2] - qt * t[2]));
    const fr = (spec.flare * Math.PI) / 180;
    const dir = v3(Math.cos(fr) * t[0] + Math.sin(fr) * p[0], Math.cos(fr) * t[1] + Math.sin(fr) * p[1], Math.cos(fr) * t[2] + Math.sin(fr) * p[2]);
    const el = v3(sh[0] + 0.28 * dir[0], sh[1] + 0.28 * dir[1], sh[2] + 0.28 * dir[2]);
    const wr = v3(sh[0] + 0.05 * s, 0.3, -0.05);
    world[L ? LM.L_SHOULDER : LM.R_SHOULDER] = sh;
    world[L ? LM.L_HIP : LM.R_HIP] = hip;
    world[L ? LM.L_ELBOW : LM.R_ELBOW] = el;
    world[L ? LM.L_WRIST : LM.R_WRIST] = wr;
    // Rough floor-level perspective: near points low and wide, far points high and narrow.
    pts[L ? LM.L_SHOULDER : LM.R_SHOULDER] = [cx + 110 * s, 430];
    pts[L ? LM.L_ELBOW : LM.R_ELBOW] = [cx + (110 + 160 * Math.sin(fr)) * s, 470];
    pts[L ? LM.L_WRIST : LM.R_WRIST] = [cx + 130 * s, 600];
    for (const i of L ? [LM.L_PINKY, LM.L_INDEX, LM.L_THUMB] : [LM.R_PINKY, LM.R_INDEX, LM.R_THUMB]) pts[i] = [cx + 130 * s, 610];
    pts[L ? LM.L_HIP : LM.R_HIP] = [cx + 70 * s, 400];
    pts[L ? LM.L_KNEE : LM.R_KNEE] = [cx + 55 * s, 395];
    pts[L ? LM.L_ANKLE : LM.R_ANKLE] = [cx + 45 * s, 392];
    pts[L ? LM.L_HEEL : LM.R_HEEL] = [cx + 45 * s, 388];
    pts[L ? LM.L_FOOT : LM.R_FOOT] = [cx + 45 * s, 398];
    pts[L ? LM.L_EAR : LM.R_EAR] = [cx + 35 * s, 425];
  }
  pts[LM.NOSE] = [cx, 445];
  for (const i of [1, 2, 3, 4, 5, 6, LM.MOUTH_L, LM.MOUTH_R]) pts[i] = [cx + (i % 2 ? -10 : 10), 440];
  return makePose(pts, { W, H, world });
}

export interface Plank3DSpec {
  /** 3D elbow angle (both arms). */
  elbow: number;
  /** Hip offset below (+) / above (−) the shoulder→ankle line, in shoulder–hip lengths. */
  sag?: number;
}

/**
 * Push-up as MediaPipe world landmarks (metres, y DOWN, z toward the camera negative): toes at the
 * origin, head toward +x, hands planted on the floor under the shoulders.
 */
export function plank3D(spec: Plank3DSpec): Landmark[] {
  type V = [number, number, number];
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a: V): V => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
  const ua = 0.28;
  const fa = 0.26;
  const d = Math.sqrt(ua * ua + fa * fa - 2 * ua * fa * Math.cos((spec.elbow * Math.PI) / 180));
  // Scene space (y up) first.
  const P: V[] = Array.from({ length: 33 }, () => [0.7, 0.3, 0] as V);
  const sides = [
    { s: 1, sh: LM.L_SHOULDER, el: LM.L_ELBOW, wr: LM.L_WRIST, hip: LM.L_HIP, kn: LM.L_KNEE, an: LM.L_ANKLE, he: LM.L_HEEL, ft: LM.L_FOOT, ear: LM.L_EAR, hand: [LM.L_PINKY, LM.L_INDEX, LM.L_THUMB] },
    { s: -1, sh: LM.R_SHOULDER, el: LM.R_ELBOW, wr: LM.R_WRIST, hip: LM.R_HIP, kn: LM.R_KNEE, an: LM.R_ANKLE, he: LM.R_HEEL, ft: LM.R_FOOT, ear: LM.R_EAR, hand: [LM.R_PINKY, LM.R_INDEX, LM.R_THUMB] },
  ];
  for (const c of sides) {
    const W: V = [1.45, 0, 0.22 * c.s];
    const S: V = [1.45, Math.sqrt(d * d - 0.04 * 0.04), 0.18 * c.s];
    // Elbow by two-bone IK, bending back toward the feet and slightly out.
    const u = unit(sub(W, S));
    const x = (ua * ua - fa * fa + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(ua * ua - x * x, 0));
    const hint: V = [-1, 0.3, 0.3 * c.s];
    const p = unit(sub(hint, mul(u, dot(hint, u))));
    const E = add(S, add(mul(u, x), mul(p, h)));
    const A: V = [0.06, 0.09, 0.1 * c.s];
    const line = unit(sub(A, S));
    const down: V = [0, -1, 0];
    const n = unit(sub(down, mul(line, dot(down, line))));
    const T = 0.5;
    const H = add(S, add(mul(line, T), mul(n, (spec.sag ?? 0) * T)));
    const K = mul(add(H, A), 0.5);
    P[c.wr] = W;
    for (const i of c.hand) P[i] = add(W, [0.06, 0, 0]);
    P[c.sh] = S;
    P[c.el] = E;
    P[c.hip] = H;
    P[c.kn] = K;
    P[c.an] = A;
    P[c.he] = [-0.01, 0.13, 0.1 * c.s];
    P[c.ft] = [0, 0, 0.1 * c.s];
  }
  const Sm = mul(add(P[LM.L_SHOULDER], P[LM.R_SHOULDER]), 0.5);
  const Hm = mul(add(P[LM.L_HIP], P[LM.R_HIP]), 0.5);
  const fwd = unit(sub(Sm, Hm));
  const nose = add(Sm, add(mul(fwd, 0.22), [0, -0.05, 0]));
  P[LM.NOSE] = nose;
  for (const i of [1, 2, 3, 4, 5, 6, LM.MOUTH_L, LM.MOUTH_R]) P[i] = nose;
  P[LM.L_EAR] = add(nose, [-0.06, 0.03, 0.07]);
  P[LM.R_EAR] = add(nose, [-0.06, 0.03, -0.07]);
  // Scene → MediaPipe world (inverse of toScene: flip y and z).
  return P.map(([x, y, z]) => ({ x, y: -y, z: -z, visibility: 1 }));
}
