// Pure geometry helpers for the SVG pose overlay (pixel space of the measured image, y down).
import type { AngleMeasurement, Landmark, PoseResult, Pt } from "@/lib/types";
import { VISIBILITY_MIN } from "@/lib/pose/landmarks";

/** Round to 0.01 px so SSR and client trig agree exactly (avoids hydration mismatches). */
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const toPts = (pose: PoseResult): Pt[] => pose.landmarks.map((l) => ({ x: r2(l.x * pose.width), y: r2(l.y * pose.height) }));
export const isReliable = (l: Landmark | undefined) => !!l && (l.visibility ?? 1) >= VISIBILITY_MIN;

const rad = (d: number) => (d * Math.PI) / 180;
export const polar = (c: Pt, r: number, a: number): Pt => ({ x: r2(c.x + r * Math.cos(a)), y: r2(c.y + r * Math.sin(a)) });

export interface ArcGeom {
  /** Vertex. */
  B: Pt;
  A: Pt;
  Cpt: Pt;
  r: number;
  /** Direction angle (radians) of BA. */
  a0: number;
  /** +1 when the sweep from BA to BC is clockwise on screen (positive angle in SVG coords). */
  dir: 1 | -1;
  /** Geometric BA→BC angle in degrees. */
  geomDeg: number;
}

export function arcGeom(pts: Pt[], m: AngleMeasurement, minDim: number): ArcGeom | null {
  if (!m.points) return null;
  const [ia, ib, ic] = m.points;
  const A = pts[ia];
  const B = pts[ib];
  const Cp = pts[ic];
  if (!A || !B || !Cp) return null;
  const ax = A.x - B.x;
  const ay = A.y - B.y;
  const cx = Cp.x - B.x;
  const cy = Cp.y - B.y;
  if (Math.hypot(ax, ay) < 1 || Math.hypot(cx, cy) < 1) return null;
  const cross = ax * cy - ay * cx;
  const dot = ax * cx + ay * cy;
  const geomDeg = (Math.abs(Math.atan2(cross, dot)) * 180) / Math.PI;
  return { B, A, Cpt: Cp, r: r2(0.08 * minDim), a0: Math.atan2(ay, ax), dir: cross >= 0 ? 1 : -1, geomDeg };
}

/** Closed wedge (pie slice) from BA rotating `fromDeg`→`toDeg` (degrees, clamped 0..360). */
export function wedgePath(g: ArcGeom, fromDeg: number, toDeg: number, r = g.r): string {
  const f = Math.max(0, Math.min(359.9, fromDeg));
  const t = Math.max(0, Math.min(359.9, toDeg));
  const s = polar(g.B, r, g.a0 + g.dir * rad(f));
  const e = polar(g.B, r, g.a0 + g.dir * rad(t));
  const large = Math.abs(t - f) > 180 ? 1 : 0;
  const sweep = g.dir === 1 ? (t >= f ? 1 : 0) : t >= f ? 0 : 1;
  return `M ${g.B.x} ${g.B.y} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y} Z`;
}

/** Open arc from `fromDeg` → `deg` along radius r (either direction). */
export function arcPath(g: ArcGeom, deg: number, r = g.r, fromDeg = 0): string {
  const f = Math.max(0, Math.min(359.9, fromDeg));
  let t = Math.max(0, Math.min(359.9, deg));
  if (Math.abs(t - f) < 0.2) t = f + 0.2;
  const s = polar(g.B, r, g.a0 + g.dir * rad(f));
  const e = polar(g.B, r, g.a0 + g.dir * rad(t));
  const large = Math.abs(t - f) > 180 ? 1 : 0;
  const sweep = g.dir === 1 ? (t >= f ? 1 : 0) : t >= f ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y}`;
}

/** Arrow head at the end of an arc running fromDeg → toDeg. */
export function arcArrowHead(g: ArcGeom, fromDeg: number, toDeg: number, r: number, size: number): string {
  const th = g.a0 + g.dir * rad(toDeg);
  const e = polar(g.B, r, th);
  const s = Math.sign(toDeg - fromDeg) * g.dir || 1;
  const ux = -Math.sin(th) * s;
  const uy = Math.cos(th) * s;
  const l = { x: r2(e.x - ux * size - uy * size * 0.6), y: r2(e.y - uy * size + ux * size * 0.6) };
  const rr = { x: r2(e.x - ux * size + uy * size * 0.6), y: r2(e.y - uy * size - ux * size * 0.6) };
  return `M ${l.x} ${l.y} L ${e.x} ${e.y} L ${rr.x} ${rr.y}`;
}

/** Point at angle `deg` from BA at radius r. */
export const pointAt = (g: ArcGeom, deg: number, r: number) => polar(g.B, r, g.a0 + g.dir * rad(deg));

/** Label chip anchor along the bisector, auto-flipped/clamped to stay in bounds. */
export function labelAnchor(g: ArcGeom, deg: number, W: number, H: number, chipW: number, chipH: number): { x: number; y: number; lead: Pt } {
  // Bisector of the reflex side (outside the joint) keeps the chip off the limb.
  let p = pointAt(g, deg / 2 + 180, g.r * 2.4);
  const lead = pointAt(g, deg / 2 + 180, g.r * 0.9);
  if (p.x - chipW / 2 < 4 || p.x + chipW / 2 > W - 4 || p.y - chipH / 2 < 4 || p.y + chipH / 2 > H - 4) {
    // flip to the inside bisector
    p = pointAt(g, deg / 2, g.r * 2.4);
  }
  const x = Math.min(W - chipW / 2 - 6, Math.max(chipW / 2 + 6, p.x));
  const y = Math.min(H - chipH / 2 - 6, Math.max(chipH / 2 + 6, p.y));
  return { x, y, lead };
}

/** Kinematic children for ghost forward kinematics (rotating a distal joint drags its children). */
const CHILDREN: Record<number, number[]> = {
  11: [13], 12: [14], 13: [15], 14: [16], 15: [17, 19, 21], 16: [18, 20, 22],
  23: [25], 24: [26], 25: [27], 26: [28], 27: [29, 31], 28: [30, 32],
};
function descendants(i: number, out: Set<number> = new Set()): Set<number> {
  out.add(i);
  for (const c of CHILDREN[i] ?? []) descendants(c, out);
  return out;
}
const rotateAbout = (p: Pt, c: Pt, a: number): Pt => ({
  x: r2(c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a)),
  y: r2(c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a)),
});

/**
 * Fallback ghost pose (pixel points): rotate each out-of-range joint's distal segment so the
 * geometric angle hits the target ideal. Used only when the integrator does not pass ghostPoints.
 */
export function computeGhostPoints(pose: PoseResult, angles: AngleMeasurement[]): Pt[] {
  let pts = toPts(pose);
  const minDim = Math.min(pose.width, pose.height);
  for (const m of angles) {
    if (m.unit !== "°" || !m.points || !m.target || (m.status !== "bad" && m.status !== "borderline")) continue;
    const g = arcGeom(pts, m, minDim);
    if (!g) continue;
    const delta = rad(m.target.ideal - g.geomDeg) * g.dir;
    const moving = descendants(m.points[2]);
    pts = pts.map((p, i) => (moving.has(i) ? rotateAbout(p, g.B, delta) : p));
  }
  return pts;
}

/** Quadratic telestrator arrow from p to q, bowed by `bow` (fraction of length). */
export function curvedArrow(p: Pt, q: Pt, bow = 0.25): { d: string; head: string } {
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ctrl = { x: r2(mx - (dy / len) * len * bow), y: r2(my + (dx / len) * len * bow) };
  const d = `M ${p.x} ${p.y} Q ${ctrl.x} ${ctrl.y} ${q.x} ${q.y}`;
  // arrow head oriented along the tangent at q
  const tx = q.x - ctrl.x;
  const ty = q.y - ctrl.y;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const s = Math.max(10, len * 0.18);
  const l = { x: r2(q.x - ux * s - uy * s * 0.55), y: r2(q.y - uy * s + ux * s * 0.55) };
  const r = { x: r2(q.x - ux * s + uy * s * 0.55), y: r2(q.y - uy * s - ux * s * 0.55) };
  return { d, head: `M ${l.x} ${l.y} L ${q.x} ${q.y} L ${r.x} ${r.y}` };
}
