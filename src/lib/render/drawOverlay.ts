// Canvas versions of the overlay primitives (spec §7.10) and the before/after PNG export.
import type { AngleMeasurement, AngleReport, Landmark, PoseResult, Verdict } from "../types";
import { DRAWN_JOINTS, POSE_CONNECTIONS, VISIBILITY_MIN } from "../pose/landmarks";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const PALETTE = {
  bg: "#07090C",
  panel: "#0E1217",
  volt: "#C6FF3D",
  signal: "#FF3B5C",
  cyan: "#2EE6FF",
  amber: "#FFB020",
  grey: "#6B7480",
  text: "#F4F7FA",
} as const;

export const VERDICT_COLOR: Record<Verdict, string> = {
  good: PALETTE.volt,
  borderline: PALETTE.amber,
  bad: PALETTE.signal,
  unmeasurable: PALETTE.grey,
};

export interface OverlayOptions {
  /** Pixel size the landmarks are mapped to (defaults to pose.width/height). */
  width?: number;
  height?: number;
  showSkeleton?: boolean; // default true
  showAngles?: boolean; // default true
  /** Only draw angles with these keys (default: all measured joint angles). */
  angleKeys?: string[];
  /** Max number of angle arcs (most severe first). Default 3. */
  maxAngles?: number;
}

// ───────────── pure geometry ─────────────

const DEG = Math.PI / 180;

/** Normalise an angle difference to (-π, π]. */
export function normAngle(a: number): number {
  let d = a % (2 * Math.PI);
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/** Arc parameters at vertex B from BA to BC (shorter way). */
export function arcParams(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const a1 = Math.atan2(a.y - b.y, a.x - b.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  const diff = normAngle(a2 - a1);
  return { start: a1, end: a1 + diff, ccw: diff < 0, sign: diff < 0 ? -1 : 1, bisector: a1 + diff / 2 };
}

/** Label text like `112° → ≤95°` / `0.02 → ≥0.05`. */
export function angleLabel(m: Pick<AngleMeasurement, "value" | "unit" | "target">): string {
  const fmt = (v: number) => (m.unit === "ratio" ? v.toFixed(2) : `${Math.round(v)}°`);
  const val = m.value === null ? "—" : fmt(m.value);
  const t = m.target;
  if (!t) return val;
  let tgt: string;
  if (t.min !== undefined && t.max !== undefined) tgt = `${fmt(t.min)}–${fmt(t.max)}`;
  else if (t.max !== undefined) tgt = `≤${fmt(t.max)}`;
  else if (t.min !== undefined) tgt = `≥${fmt(t.min)}`;
  else tgt = fmt(t.ideal);
  return `${val} → ${tgt}`;
}

const severityRank: Record<Verdict, number> = { bad: 0, borderline: 1, good: 2, unmeasurable: 3 };

/** Angles to draw: joint angles with points and a value, worst first. */
export function anglesToDraw(report: AngleReport | null | undefined, opts: Pick<OverlayOptions, "angleKeys" | "maxAngles"> = {}) {
  if (!report) return [];
  return report.angles
    .filter((a) => a.points && a.value !== null && a.unit === "°")
    .filter((a) => !opts.angleKeys || opts.angleKeys.includes(a.key))
    .sort((x, y) => severityRank[x.status] - severityRank[y.status] || y.deviation - x.deviation)
    .slice(0, opts.maxAngles ?? 3);
}

// ───────────── drawing ─────────────

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const vis = (l: Landmark | undefined) => (l?.visibility ?? 0) >= VISIBILITY_MIN;

/** Draw skeleton + angle arcs for one pose. Landmarks are normalised; mapped to opts.width×height. */
export function drawPoseOverlay(
  ctx: Ctx2D,
  pose: PoseResult | null | undefined,
  report: AngleReport | null | undefined,
  opts: OverlayOptions = {},
): void {
  if (!pose || pose.landmarks.length < 33) return;
  const W = opts.width ?? pose.width;
  const H = opts.height ?? pose.height;
  const u = Math.min(W, H) / 1000; // unit scale; 1 at a 1000 px short edge
  const P = pose.landmarks.map((l) => ({ x: l.x * W, y: l.y * H }));
  const drawn = anglesToDraw(report, opts);
  const problem = new Set(drawn.filter((a) => a.status === "bad").map((a) => a.points![1]));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (opts.showSkeleton !== false) {
    for (const [i, j] of POSE_CONNECTIONS) {
      const ok = vis(pose.landmarks[i]) && vis(pose.landmarks[j]);
      ctx.strokeStyle = ok ? PALETTE.cyan : "rgba(107,116,128,0.7)";
      ctx.lineWidth = Math.max(2, 4 * u * 1.4);
      ctx.setLineDash(ok ? [] : [8 * u, 8 * u]);
      ctx.shadowColor = ok ? "rgba(46,230,255,0.6)" : "transparent";
      ctx.shadowBlur = ok ? 8 * u : 0;
      ctx.beginPath();
      ctx.moveTo(P[i].x, P[i].y);
      ctx.lineTo(P[j].x, P[j].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const i of DRAWN_JOINTS) {
      const isProblem = problem.has(i);
      const r = Math.max(3, 6 * u * 1.4) * (isProblem ? 1.4 : 1);
      ctx.shadowColor = isProblem ? PALETTE.signal : "transparent";
      ctx.shadowBlur = isProblem ? 18 * u : 0;
      ctx.fillStyle = isProblem ? PALETTE.signal : vis(pose.landmarks[i]) ? PALETTE.cyan : PALETTE.grey;
      ctx.strokeStyle = PALETTE.bg;
      ctx.lineWidth = Math.max(1.5, 2 * u * 1.4);
      ctx.beginPath();
      ctx.arc(P[i].x, P[i].y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (isProblem) {
        ctx.strokeStyle = PALETTE.signal;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(P[i].x, P[i].y, r * 2.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  if (opts.showAngles !== false) {
    const R = 0.08 * Math.min(W, H);
    for (const m of drawn) {
      const [ia, ib, ic] = m.points!;
      const A = P[ia];
      const B = P[ib];
      const C = P[ic];
      const arc = arcParams(A, B, C);
      const color = VERDICT_COLOR[m.status];
      // target wedge (interior-angle range measured from BA towards BC)
      if (m.target && (m.target.min !== undefined || m.target.max !== undefined)) {
        const lo = (m.target.min ?? 0) * DEG;
        const hi = Math.min(180, m.target.max ?? 180) * DEG;
        ctx.fillStyle = "rgba(198,255,61,0.18)";
        ctx.strokeStyle = "rgba(198,255,61,0.55)";
        ctx.lineWidth = Math.max(1, 1.5 * u);
        ctx.beginPath();
        ctx.moveTo(B.x, B.y);
        ctx.arc(B.x, B.y, R * 1.25, arc.start + arc.sign * lo, arc.start + arc.sign * hi, arc.ccw);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // actual arc
      ctx.fillStyle = color + "40";
      ctx.beginPath();
      ctx.moveTo(B.x, B.y);
      ctx.arc(B.x, B.y, R, arc.start, arc.end, arc.ccw);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 4 * u);
      ctx.beginPath();
      ctx.arc(B.x, B.y, R, arc.start, arc.end, arc.ccw);
      ctx.stroke();
      // label chip on the bisector, outside the arc; flipped/clamped into bounds
      const text = angleLabel(m);
      const fs = Math.max(12, Math.round(26 * u * 1.3));
      ctx.font = `600 ${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      const tw = ctx.measureText(text).width;
      const cw = tw + fs;
      const ch = fs * 1.6;
      let dir = arc.bisector + Math.PI; // the chip goes opposite the interior, away from the bones
      let lx = B.x + Math.cos(dir) * R * 2;
      let ly = B.y + Math.sin(dir) * R * 2;
      if (lx - cw / 2 < 0 || lx + cw / 2 > W || ly - ch / 2 < 0 || ly + ch / 2 > H) {
        dir = arc.bisector;
        lx = B.x + Math.cos(dir) * R * 2;
        ly = B.y + Math.sin(dir) * R * 2;
      }
      lx = Math.min(W - cw / 2 - 4, Math.max(cw / 2 + 4, lx));
      ly = Math.min(H - ch / 2 - 4, Math.max(ch / 2 + 4, ly));
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.beginPath();
      ctx.moveTo(B.x + Math.cos(dir) * R, B.y + Math.sin(dir) * R);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.fillStyle = "rgba(7,9,12,0.88)";
      roundRect(ctx, lx - cw / 2, ly - ch / 2, cw, ch, ch / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, lx, ly + 1);
    }
  }
  ctx.restore();
}

// ───────────── export ─────────────

export type ImageInput = string | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

async function toDrawable(src: ImageInput): Promise<{ img: CanvasImageSource; w: number; h: number }> {
  if (typeof src === "string") {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = src;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement)
    return { img: src, w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  return { img: src, w: src.width, h: src.height };
}

export interface ExportOptions {
  score?: number; // defaults to reports[0].score
  grade?: string;
  afterScore?: number;
  subtitle?: string; // e.g. "Pull-up · rep 3"
  width?: number; // default 2160
  height?: number; // default 1350
}

/** Side-by-side PNG: BEFORE | AFTER with overlays, score and GYM BRO branding. */
export async function exportBeforeAfter(
  before: ImageInput,
  after: ImageInput,
  poses: [PoseResult | null | undefined, PoseResult | null | undefined],
  reports: [AngleReport | null | undefined, AngleReport | null | undefined],
  opts: ExportOptions = {},
): Promise<Blob> {
  const W = opts.width ?? 2160;
  const H = opts.height ?? 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, H);

  const header = Math.round(H * 0.1);
  const pad = Math.round(W * 0.018);
  const panelW = (W - pad * 3) / 2;
  const panelH = H - header - pad * 1.5;
  const imgs = await Promise.all([toDrawable(before), toDrawable(after)]);

  // header
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.round(header * 0.48)}px "Arial Black", Impact, system-ui, sans-serif`;
  ctx.fillStyle = PALETTE.volt;
  ctx.textAlign = "left";
  ctx.fillText("GYM BRO", pad, header / 2);
  const brandW = ctx.measureText("GYM BRO").width;
  if (opts.subtitle) {
    ctx.font = `500 ${Math.round(header * 0.26)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = PALETTE.grey;
    ctx.fillText(opts.subtitle.toUpperCase(), pad * 2 + brandW, header / 2 + 2);
  }
  const score = opts.score ?? reports[0]?.score;
  const grade = opts.grade ?? reports[0]?.grade;
  if (score !== undefined) {
    ctx.textAlign = "right";
    ctx.font = `800 ${Math.round(header * 0.44)}px ui-monospace, Menlo, Consolas, monospace`;
    const sc = score >= 80 ? PALETTE.volt : score >= 60 ? PALETTE.amber : PALETTE.signal;
    const afterTxt = opts.afterScore !== undefined ? ` → ${Math.round(opts.afterScore)}` : "";
    const txt = `${Math.round(score)}${afterTxt}${grade ? ` · ${grade}` : ""}`;
    ctx.fillStyle = sc;
    ctx.fillText(txt, W - pad, header / 2);
    const tw = ctx.measureText(txt).width;
    ctx.font = `600 ${Math.round(header * 0.22)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = PALETTE.grey;
    ctx.fillText("FORM SCORE", W - pad - tw - pad * 0.6, header / 2 + 2);
  }

  const labels = ["BEFORE", "AFTER"] as const;
  imgs.forEach(({ img, w, h }, k) => {
    const px = pad + k * (panelW + pad);
    const py = header;
    ctx.fillStyle = PALETTE.panel;
    roundRect(ctx, px, py, panelW, panelH, 18);
    ctx.fill();
    const s = Math.min(panelW / w, panelH / h);
    const dw = w * s;
    const dh = h * s;
    const dx = px + (panelW - dw) / 2;
    const dy = py + (panelH - dh) / 2;
    ctx.save();
    roundRect(ctx, px, py, panelW, panelH, 18);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.translate(dx, dy);
    drawPoseOverlay(ctx, poses[k], reports[k], { width: dw, height: dh });
    ctx.restore();
    // label chip
    const fs = Math.round(header * 0.3);
    ctx.font = `800 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    const tw = ctx.measureText(labels[k]).width;
    const color = k === 0 ? PALETTE.signal : PALETTE.volt;
    ctx.fillStyle = "rgba(7,9,12,0.85)";
    roundRect(ctx, px + 20, py + 20, tw + fs * 1.4, fs * 1.8, fs * 0.9);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labels[k], px + 20 + fs * 0.7, py + 20 + fs * 0.9 + 1);
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
}
