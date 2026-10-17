"use client";
// SVG telestrator overlay: bones, joints, pulsing problem joints, angle arcs with target wedges,
// label chips and curved correction arrows. viewBox = intrinsic pixel size of the measured image.
import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { AngleMeasurement, PoseResult, Pt } from "@/lib/types";
import { DRAWN_JOINTS, POSE_CONNECTIONS } from "@/lib/pose/landmarks";
import { cn } from "@/lib/utils";
import { C, fmtTarget, verdictColor } from "@/components/shared/tokens";
import { METRIC_JOINTS, MetricGlyph } from "./MetricGlyphs";
import { arcArrowHead, arcGeom, arcPath, isReliable, labelAnchor, toPts, wedgePath } from "./overlayGeometry";

export type OverlayVariant = "measured" | "verified" | "ghost";

export interface PoseOverlayProps {
  /** Pose in the image's pixel space (landmarks normalised to width/height). */
  pose?: PoseResult | null;
  /** Explicit pixel points (overrides pose landmarks; used for the ghost skeleton). */
  points?: Pt[] | null;
  /** viewBox size; defaults to pose.width/height. */
  width?: number;
  height?: number;
  angles?: AngleMeasurement[];
  visible?: boolean;
  variant?: OverlayVariant;
  showArcs?: boolean;
  showArrows?: boolean;
  /** Play the skeleton draw-on / arc sweep when mounted. */
  animate?: boolean;
  preserveAspectRatio?: "xMidYMid meet" | "xMidYMid slice";
  className?: string;
  testId?: string;
  /** Extra delay (s) before the draw-on starts. */
  delay?: number;
}

const SKIP_FACE = new Set([0, 7, 8]);

export function PoseOverlay({
  pose,
  points,
  width,
  height,
  angles = [],
  visible = true,
  variant = "measured",
  showArcs = true,
  showArrows = true,
  animate = true,
  preserveAspectRatio = "xMidYMid meet",
  className,
  testId,
  delay = 0,
}: PoseOverlayProps) {
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const play = animate && !reduce;
  const W = width ?? pose?.width ?? 1000;
  const H = height ?? pose?.height ?? 1000;
  const minDim = Math.min(W, H);

  const pts = useMemo<Pt[]>(() => points ?? (pose ? toPts(pose) : []), [points, pose]);
  const rel = (i: number) => (points ? true : isReliable(pose?.landmarks[i]));

  const ghost = variant === "ghost";
  const boneColor = ghost ? C.volt : C.cyan;

  const arcs = useMemo(() => {
    if (!showArcs || !pts.length) return [];
    return angles
      .filter((m) => m.points && m.value != null && m.unit === "°" && m.status !== "unmeasurable")
      .map((m) => ({ m, g: arcGeom(pts, m, minDim) }))
      .filter((a): a is { m: AngleMeasurement; g: NonNullable<ReturnType<typeof arcGeom>> } => !!a.g);
  }, [angles, pts, minDim, showArcs]);

  const problemJoints = useMemo(() => {
    const s = new Map<number, string>();
    if (ghost) return s;
    for (const m of angles) {
      if (m.status !== "bad" && m.status !== "borderline") continue;
      const joints = m.points ? [m.points[1]] : (METRIC_JOINTS[m.key] ?? []);
      for (const j of joints) if (!s.has(j) || m.status === "bad") s.set(j, verdictColor(m.status));
    }
    return s;
  }, [angles, ghost]);

  const glyphs = showArcs && pts.length
    ? angles.filter((m) => !m.points && METRIC_JOINTS[m.key] && m.value != null && m.status !== "unmeasurable" && (m.status !== "good" || variant === "verified"))
    : [];

  if (!pts.length) return null;

  const jointR = minDim * 0.0105;
  const font = Math.max(14, minDim * 0.032);
  const T = (d: number) => (play ? { delay: delay + d } : { duration: 0 });

  return (
    <motion.svg
      data-testid={testId ?? (ghost ? "ghost-overlay" : "pose-overlay")}
      data-variant={variant}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={preserveAspectRatio}
      className={cn("pointer-events-none absolute inset-0 h-full w-full overflow-visible", className)}
      initial={false}
      animate={visible ? { opacity: 1, visibility: "visible" } : { opacity: 0, transitionEnd: { visibility: "hidden" } }}
      transition={{ duration: 0.15 }}
      aria-hidden={!visible}
      role="img"
      aria-label={ghost ? "Target form ghost skeleton" : "Pose skeleton with joint angles"}
    >
      <defs>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={minDim * 0.006} result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`shadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy={minDim * 0.003} stdDeviation={minDim * 0.004} floodColor="#000" floodOpacity="0.7" />
        </filter>
      </defs>

      {/* Bones */}
      <g filter={`url(#glow-${uid})`} strokeLinecap="round">
        {POSE_CONNECTIONS.map(([a, b], i) => {
          const p = pts[a];
          const q = pts[b];
          if (!p || !q) return null;
          const ok = rel(a) && rel(b);
          const face = SKIP_FACE.has(a) || SKIP_FACE.has(b);
          return (
            <motion.path
              key={`${a}-${b}`}
              d={`M ${p.x} ${p.y} L ${q.x} ${q.y}`}
              fill="none"
              stroke={ok ? boneColor : C.dim}
              strokeOpacity={ok ? (face ? 0.55 : 0.95) : 0.55}
              strokeWidth={ghost ? 3 : 4}
              strokeDasharray={!ok || ghost ? "6 6" : undefined}
              vectorEffect="non-scaling-stroke"
              initial={play ? { pathLength: 0, opacity: 0 } : false}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1], ...T(i * 0.03) }}
            />
          );
        })}
      </g>

      {/* Joints */}
      <g>
        {DRAWN_JOINTS.map((j, i) => {
          const p = pts[j];
          if (!p) return null;
          const ok = rel(j);
          return (
            <motion.circle
              key={j}
              cx={p.x}
              cy={p.y}
              r={SKIP_FACE.has(j) ? jointR * 0.7 : jointR}
              fill={ghost ? C.bg : ok ? C.text : C.dim}
              fillOpacity={ghost ? 0.6 : 1}
              stroke={ghost ? C.volt : C.bg}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              initial={play ? { scale: 0, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              transition={{ type: "spring", stiffness: 500, damping: 26, ...T(0.25 + i * 0.02) }}
            />
          );
        })}
      </g>

      {/* Problem joints: red glow + pulsing ring */}
      {[...problemJoints.entries()].map(([j, color]) => {
        const p = pts[j];
        if (!p) return null;
        return (
          <g key={`pj-${j}`}>
            <circle cx={p.x} cy={p.y} r={jointR * 1.25} fill={color} style={{ filter: `drop-shadow(0 0 ${minDim * 0.012}px ${color})` }} />
            <motion.circle
              cx={p.x}
              cy={p.y}
              r={jointR * 2.4}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              animate={reduce ? { opacity: 0.8 } : { scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }}
              transition={reduce ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </g>
        );
      })}

      {/* Point-less metrics (shoulder tilt, sway, chin clearance) */}
      {glyphs.map((m, k) => (
        <MetricGlyph key={m.key} m={m} pts={pts} W={W} H={H} font={font} shadowId={`shadow-${uid}`} delay={delay + 0.55 + k * 0.15} play={play} verified={variant === "verified"} showArrows={showArrows} />
      ))}

      {/* Angle arcs, target wedges, label chips, correction arrows */}
      {arcs.map(({ m, g }, k) => {
        const value = m.value as number;
        const color = variant === "verified" && m.status === "good" ? C.volt : verdictColor(m.status);
        const t = m.target;
        const tMin = t?.min ?? (t ? 0 : undefined);
        const tMax = t?.max ?? (t ? 180 : undefined);
        const label = `${Math.round(value)}°${t && m.status !== "good" ? ` → ${fmtTarget(t, m.unit)}` : m.status === "good" ? " ✓" : ""}`;
        const chipH = font * 1.7;
        const chipW = label.length * font * 0.62 + font * 1.2;
        const anchor = labelAnchor(g, value, W, H, chipW, chipH);
        const needsFix = t && (m.status === "bad" || m.status === "borderline");
        const ar = Math.round(g.r * 155) / 100;
        const d0 = 0.55 + k * 0.15;
        return (
          <g key={m.key}>
            {tMin != null && tMax != null && (
              <motion.path
                d={wedgePath(g, tMin, tMax, g.r * 1.15)}
                fill={C.volt}
                fillOpacity={0.16}
                stroke={C.volt}
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                initial={play ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ...T(d0) }}
              />
            )}
            <motion.path
              d={wedgePath(g, 0, value)}
              fill={color}
              fillOpacity={0.22}
              initial={play ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ...T(d0 + 0.3) }}
            />
            <motion.path
              d={arcPath(g, value)}
              fill="none"
              stroke={color}
              strokeWidth={3.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 6px ${color})` }}
              initial={play ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, ease: "easeOut", ...T(d0 + 0.2) }}
            />
            {showArrows && needsFix && Math.abs(t!.ideal - value) > 3 && (
              <motion.g
                initial={play ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ...T(d0 + 0.75) }}
              >
                <motion.path
                  d={arcPath(g, t!.ideal, ar, value)}
                  fill="none"
                  stroke={C.volt}
                  strokeWidth={3}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ filter: `drop-shadow(0 0 5px ${C.volt})` }}
                  initial={play ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.55, ease: "easeInOut", ...T(d0 + 0.8) }}
                />
                <path
                  d={arcArrowHead(g, value, t!.ideal, ar, g.r * 0.32)}
                  fill="none"
                  stroke={C.volt}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </motion.g>
            )}
            {/* leader + chip */}
            <motion.g
              filter={`url(#shadow-${uid})`}
              initial={play ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ...T(d0 + 0.45) }}
            >
              <line
                x1={anchor.lead.x}
                y1={anchor.lead.y}
                x2={anchor.x}
                y2={anchor.y}
                stroke={color}
                strokeOpacity={0.8}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={anchor.x - chipW / 2}
                y={anchor.y - chipH / 2}
                width={chipW}
                height={chipH}
                rx={chipH / 2}
                fill={C.bg}
                fillOpacity={0.88}
                stroke={color}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={anchor.x}
                y={anchor.y}
                dy="0.35em"
                textAnchor="middle"
                fill={C.text}
                fontSize={font}
                fontWeight={700}
                style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace", fontVariantNumeric: "tabular-nums" }}
              >
                <tspan fill={color}>{`${Math.round(value)}°`}</tspan>
                {label.slice(`${Math.round(value)}°`.length)}
              </text>
            </motion.g>
          </g>
        );
      })}
    </motion.svg>
  );
}
