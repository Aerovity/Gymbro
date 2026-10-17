"use client";
// Telestrator glyphs for metrics without a joint vertex (no `points`):
// shoulder_tilt (shoulder line vs dashed horizontal, "level" arrow on the higher shoulder),
// body_sway (plumb line from the hands vs hip offset), chin_clearance (bar line vs nose).
import { motion } from "motion/react";
import type { AngleMeasurement, Pt } from "@/lib/types";
import { LM } from "@/lib/pose/landmarks";
import { C, fmtTarget, fmtValue, verdictColor } from "@/components/shared/tokens";
import { curvedArrow, r2 } from "./overlayGeometry";

/** Landmarks that represent each point-less metric (used for the problem-joint glow). */
export const METRIC_JOINTS: Record<string, number[]> = {
  shoulder_tilt: [LM.L_SHOULDER, LM.R_SHOULDER],
  body_sway: [LM.L_HIP, LM.R_HIP],
  chin_clearance: [LM.NOSE],
};
const SHORT: Record<string, string> = { shoulder_tilt: "tilt", body_sway: "sway", chin_clearance: "chin" };

export interface ChipProps {
  x: number;
  y: number;
  lead?: Pt;
  value: string;
  rest: string;
  color: string;
  font: number;
  shadowId: string;
  delay: number;
  play: boolean;
}

export function OverlayChip({ x, y, lead, value, rest, color, font, shadowId, delay, play }: ChipProps) {
  const chipH = font * 1.7;
  const chipW = (value.length + rest.length) * font * 0.62 + font * 1.2;
  return (
    <motion.g filter={`url(#${shadowId})`} initial={play ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={play ? { duration: 0.25, delay } : { duration: 0 }}>
      {lead && <line x1={lead.x} y1={lead.y} x2={x} y2={y} stroke={color} strokeOpacity={0.8} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      <rect x={r2(x - chipW / 2)} y={r2(y - chipH / 2)} width={r2(chipW)} height={r2(chipH)} rx={r2(chipH / 2)} fill={C.bg} fillOpacity={0.88} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <text x={x} y={y} dy="0.35em" textAnchor="middle" fill={C.text} fontSize={font} fontWeight={700} style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace", fontVariantNumeric: "tabular-nums" }}>
        <tspan fill={color}>{value}</tspan>
        {rest}
      </text>
    </motion.g>
  );
}

export const chipWidth = (text: string, font: number) => text.length * font * 0.62 + font * 1.2;

interface GlyphProps {
  m: AngleMeasurement;
  pts: Pt[];
  W: number;
  H: number;
  font: number;
  shadowId: string;
  delay: number;
  play: boolean;
  verified: boolean;
  showArrows: boolean;
}

const mid = (a: Pt, b: Pt): Pt => ({ x: r2((a.x + b.x) / 2), y: r2((a.y + b.y) / 2) });
const clampChip = (x: number, y: number, w: number, h: number, W: number, H: number) => ({
  x: r2(Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, x))),
  y: r2(Math.min(H - h / 2 - 6, Math.max(h / 2 + 6, y))),
});

export function MetricGlyph({ m, pts, W, H, font, shadowId, delay, play, verified, showArrows }: GlyphProps) {
  const color = verified && m.status === "good" ? C.volt : verdictColor(m.status);
  const minDim = Math.min(W, H);
  const fix = showArrows && (m.status === "bad" || m.status === "borderline");
  const value = fmtValue(m.value, m.unit).replace(/^\+/, "");
  const rest = ` ${SHORT[m.key] ?? ""}${m.status === "good" ? " ✓" : m.target ? ` → ${fmtTarget(m.target, m.unit)}` : ""}`;
  const w = chipWidth(value + rest, font);
  const h = font * 1.7;
  const draw = (d: number) => (play ? { duration: 0.45, delay: delay + d, ease: "easeOut" as const } : { duration: 0 });
  const stroke = { vectorEffect: "non-scaling-stroke" as const, strokeLinecap: "round" as const, fill: "none" };

  if (m.key === "shoulder_tilt") {
    const L = pts[LM.L_SHOULDER];
    const R = pts[LM.R_SHOULDER];
    if (!L || !R) return null;
    const dx = R.x - L.x;
    const dy = R.y - L.y;
    const len = Math.hypot(dx, dy) || 1;
    const ext = len * 0.28;
    const ux = dx / len;
    const uy = dy / len;
    const a = { x: r2(L.x - ux * ext), y: r2(L.y - uy * ext) };
    const b = { x: r2(R.x + ux * ext), y: r2(R.y + uy * ext) };
    const c = mid(L, R);
    const half = len / 2 + ext;
    const hi = L.y <= R.y ? L : R; // higher shoulder = smaller y
    const outward = hi === L ? -1 : 1;
    const chip = clampChip(hi.x + outward * (w / 2 + minDim * 0.03), hi.y - minDim * 0.15, w, h, W, H);
    const ax = r2(hi.x - outward * minDim * 0.015);
    const arrow = curvedArrow({ x: ax, y: r2(hi.y - minDim * 0.1) }, { x: ax, y: r2(hi.y - minDim * 0.025) }, 0.3 * outward);
    return (
      <g>
        <motion.path d={`M ${r2(c.x - half)} ${c.y} L ${r2(c.x + half)} ${c.y}`} stroke={C.text} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="6 5" {...stroke} initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={draw(0)} />
        <motion.path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={color} strokeWidth={3.5} style={{ filter: `drop-shadow(0 0 6px ${color})` }} {...stroke} initial={play ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={draw(0.15)} />
        {fix && (
          <motion.g initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={draw(0.5)}>
            <motion.path d={arrow.d} stroke={C.volt} strokeWidth={3} style={{ filter: `drop-shadow(0 0 5px ${C.volt})` }} {...stroke} initial={play ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={draw(0.55)} />
            <path d={arrow.head} stroke={C.volt} strokeWidth={3} strokeLinejoin="round" {...stroke} />
          </motion.g>
        )}
        <OverlayChip x={chip.x} y={chip.y} lead={hi} value={value} rest={rest} color={color} font={font} shadowId={shadowId} delay={delay + 0.45} play={play} />
      </g>
    );
  }

  if (m.key === "body_sway") {
    const wr = pts[LM.L_WRIST] && pts[LM.R_WRIST] ? mid(pts[LM.L_WRIST], pts[LM.R_WRIST]) : null;
    const hp = pts[LM.L_HIP] && pts[LM.R_HIP] ? mid(pts[LM.L_HIP], pts[LM.R_HIP]) : null;
    if (!wr || !hp) return null;
    const plumbEnd = { x: wr.x, y: r2(hp.y + (hp.y - wr.y) * 0.25) };
    const chip = clampChip(hp.x + (hp.x >= wr.x ? 1 : -1) * (w / 2 + minDim * 0.06), hp.y + minDim * 0.05, w, h, W, H);
    const arrow = curvedArrow({ x: hp.x, y: r2(hp.y + minDim * 0.04) }, { x: r2(wr.x + (hp.x - wr.x) * 0.15), y: r2(hp.y + minDim * 0.04) }, 0.2);
    return (
      <g>
        <motion.path d={`M ${wr.x} ${wr.y} L ${plumbEnd.x} ${plumbEnd.y}`} stroke={C.text} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="6 5" {...stroke} initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={draw(0)} />
        <motion.path d={`M ${wr.x} ${wr.y} L ${hp.x} ${hp.y}`} stroke={color} strokeWidth={3} style={{ filter: `drop-shadow(0 0 6px ${color})` }} {...stroke} initial={play ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={draw(0.15)} />
        <circle cx={hp.x} cy={hp.y} r={minDim * 0.009} fill={color} />
        {fix && Math.abs(hp.x - wr.x) > minDim * 0.02 && (
          <motion.g initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={draw(0.5)}>
            <path d={arrow.d} stroke={C.volt} strokeWidth={3} {...stroke} />
            <path d={arrow.head} stroke={C.volt} strokeWidth={3} strokeLinejoin="round" {...stroke} />
          </motion.g>
        )}
        <OverlayChip x={chip.x} y={chip.y} lead={hp} value={value} rest={rest} color={color} font={font} shadowId={shadowId} delay={delay + 0.45} play={play} />
      </g>
    );
  }

  if (m.key === "chin_clearance") {
    const nose = pts[LM.NOSE];
    const wr = pts[LM.L_WRIST] && pts[LM.R_WRIST] ? { L: pts[LM.L_WRIST], R: pts[LM.R_WRIST] } : null;
    if (!nose || !wr) return null;
    const barY = r2((wr.L.y + wr.R.y) / 2);
    const x0 = r2(Math.min(wr.L.x, wr.R.x) - minDim * 0.06);
    const x1 = r2(Math.max(wr.L.x, wr.R.x) + minDim * 0.06);
    const chip = clampChip(x1 + w / 2 + minDim * 0.01, barY - minDim * 0.06, w, h, W, H);
    const arrow = curvedArrow({ x: r2(nose.x + minDim * 0.05), y: r2(nose.y + minDim * 0.02) }, { x: r2(nose.x + minDim * 0.05), y: r2(barY - minDim * 0.07) }, 0.25);
    return (
      <g>
        <motion.path d={`M ${x0} ${barY} L ${x1} ${barY}`} stroke={C.text} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="6 5" {...stroke} initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={draw(0)} />
        <motion.path d={`M ${nose.x} ${nose.y} L ${nose.x} ${barY}`} stroke={color} strokeWidth={3} style={{ filter: `drop-shadow(0 0 6px ${color})` }} {...stroke} initial={play ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={draw(0.15)} />
        {fix && (
          <motion.g initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={draw(0.5)}>
            <path d={arrow.d} stroke={C.volt} strokeWidth={3} {...stroke} />
            <path d={arrow.head} stroke={C.volt} strokeWidth={3} strokeLinejoin="round" {...stroke} />
          </motion.g>
        )}
        <OverlayChip x={chip.x} y={chip.y} lead={{ x: x1, y: barY }} value={value} rest={rest} color={color} font={font} shadowId={shadowId} delay={delay + 0.45} play={play} />
      </g>
    );
  }
  return null;
}
