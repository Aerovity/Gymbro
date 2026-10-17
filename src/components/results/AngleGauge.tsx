"use client";
// Semicircle gauge: track, green target band, ideal tick and a needle coloured by verdict (sweeps in).
import { useId } from "react";
import type { AngleMeasurement } from "@/lib/types";
import { C, verdictColor } from "@/components/shared/tokens";
import { useCountUp } from "@/components/shared/useCountUp";

export interface AngleGaugeProps {
  m: AngleMeasurement;
  /** Optional verified-after value shown as a ghost needle. */
  after?: number | null;
  className?: string;
}

function domainFor(m: AngleMeasurement): [number, number] {
  if (m.unit === "°") return [0, 180];
  const t = m.target;
  const vals = [m.value ?? 0, t?.min, t?.max, t?.ideal].filter((v): v is number => v != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max(0.1, (hi - lo) * 0.6);
  return [lo - pad, hi + pad];
}

const CX = 100;
const CY = 100;
const R = 78;

export function AngleGauge({ m, after, className }: AngleGaugeProps) {
  const id = useId().replace(/:/g, "");
  const [lo, hi] = domainFor(m);
  const frac = (v: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const pt = (f: number, r = R) => {
    const a = Math.PI - f * Math.PI;
    return { x: Math.round((CX + r * Math.cos(a)) * 100) / 100, y: Math.round((CY - r * Math.sin(a)) * 100) / 100 };
  };
  const arc = (f0: number, f1: number, r = R) => {
    const s = pt(f0, r);
    const e = pt(f1, r);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
  };
  const val = m.value;
  const anim = useCountUp(val == null ? null : frac(val), { duration: 0.6, delay: 0.15 });
  const col = verdictColor(m.status);
  const t = m.target;
  const band = t ? [frac(t.min ?? lo), frac(t.max ?? hi)] : null;
  const needle = pt(anim, R - 6);
  const ideal = t ? pt(frac(t.ideal), R + 11) : null;
  const ideal2 = t ? pt(frac(t.ideal), R - 13) : null;
  const afterPt = after != null ? pt(frac(after), R - 6) : null;

  return (
    <svg viewBox="0 0 200 112" className={className} role="img" aria-label={`${m.label}: ${val == null ? "not measured" : Math.round(val * (m.unit === "ratio" ? 100 : 1)) / (m.unit === "ratio" ? 100 : 1)}${m.unit === "°" ? " degrees" : ""}`}>
      <defs>
        <linearGradient id={`trk-${id}`} x1="0" x2="1">
          <stop offset="0" stopColor={C.surface3} />
          <stop offset="1" stopColor="#222c3a" />
        </linearGradient>
      </defs>
      <path d={arc(0, 1)} stroke={`url(#trk-${id})`} strokeWidth={12} fill="none" strokeLinecap="round" />
      {/* minor ticks */}
      {Array.from({ length: 13 }, (_, i) => {
        const f = i / 12;
        const a = pt(f, R + 9);
        const b = pt(f, R + (i % 3 === 0 ? 14 : 11.5));
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C.dim} strokeOpacity={i % 3 === 0 ? 0.55 : 0.25} strokeWidth={1} />;
      })}
      {band && band[1] > band[0] && (
        <path d={arc(band[0], band[1])} stroke={C.volt} strokeOpacity={0.85} strokeWidth={12} fill="none" style={{ filter: `drop-shadow(0 0 4px ${C.volt}88)` }} />
      )}
      {ideal && ideal2 && <line x1={ideal.x} y1={ideal.y} x2={ideal2.x} y2={ideal2.y} stroke={C.text} strokeWidth={2} strokeLinecap="round" />}
      {afterPt && (
        <line x1={CX} y1={CY} x2={afterPt.x} y2={afterPt.y} stroke={C.volt} strokeWidth={2.5} strokeDasharray="3 3" strokeLinecap="round" opacity={0.9} />
      )}
      {val != null && (
        <>
          <line x1={CX} y1={CY} x2={needle.x} y2={needle.y} stroke={col} strokeWidth={4} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 5px ${col})` }} />
          <circle cx={needle.x} cy={needle.y} r={4.5} fill={col} stroke={C.bg} strokeWidth={2} />
        </>
      )}
      <circle cx={CX} cy={CY} r={7} fill={C.surface} stroke={val == null ? C.dim : col} strokeWidth={2.5} />
    </svg>
  );
}
