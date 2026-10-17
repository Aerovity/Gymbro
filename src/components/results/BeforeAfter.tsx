"use client";
/* eslint-disable @next/next/no-img-element */
// Before/after: react-compare-slider with a PoseOverlay on both sides and an intro auto-sweep once the
// optional AI photo exists. Before that it is the user's own frame with the measured skeleton, an optional
// dashed target ("ghost") skeleton, and a light sweep while the AI photo is being generated.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ReactCompareSlider, useReactCompareSliderContext } from "react-compare-slider";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AngleMeasurement, PoseResult, Pt } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/components/shared/tokens";
import { PoseOverlay } from "./PoseOverlay";
import { MediaFrame } from "./MediaFrame";
import { computeGhostPoints } from "./overlayGeometry";

export interface BeforeAfterProps {
  beforeImage: string;
  afterImage?: string;
  beforePose?: PoseResult;
  afterPose?: PoseResult;
  angles?: AngleMeasurement[];
  /** Angles re-measured on the after image. */
  verifyAngles?: AngleMeasurement[];
  /** Intrinsic size of the before image (crop output size). */
  width: number;
  height: number;
  showSkeleton: boolean;
  /** Draw the dashed target ("ghost") skeleton on the before frame (no after image yet). */
  showGhost?: boolean;
  /** Ghost target skeleton in before-image pixel space; computed locally when omitted. */
  ghostPoints?: Pt[];
  /** The optional AI photo is being generated: sweep a light pass over the frame. */
  pending?: boolean;
  verifyPassed?: boolean;
  verifying?: boolean;
  momentT?: number;
  /** Label of the after side, e.g. "After · AI photo" or "After · cached AI photo". */
  afterLabel?: string;
  maxHeight?: string;
  className?: string;
}

const noopSubscribe = () => () => {};
/** True only after hydration (react-compare-slider inline styles differ between SSR and client). */
const useMounted = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

function Handle({ intro }: { intro: boolean }) {
  const { setPosition } = useReactCompareSliderContext();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!intro || reduce) return;
    const c = animate(100, 50, { duration: 0.8, delay: 0.35, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => setPosition(v) });
    return () => c.stop();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="relative flex h-full w-11 flex-col items-center">
      <div className="w-[2px] flex-1 bg-volt shadow-[0_0_12px_var(--color-volt)]" />
      <div className="pointer-events-auto flex size-11 shrink-0 cursor-ew-resize items-center justify-center rounded-full border-2 border-volt bg-bg/80 text-volt shadow-[var(--shadow-glow-volt)] backdrop-blur">
        <ChevronLeft className="-mr-1 size-4" strokeWidth={3} aria-hidden />
        <ChevronRight className="-ml-1 size-4" strokeWidth={3} aria-hidden />
      </div>
      <div className="w-[2px] flex-1 bg-volt shadow-[0_0_12px_var(--color-volt)]" />
    </div>
  );
}

function Chip({ children, tone, className }: { children: React.ReactNode; tone: "signal" | "volt" | "cyan" | "amber" | "glass"; className?: string }) {
  const cls = {
    signal: "bg-signal text-white",
    volt: "bg-volt text-bg",
    cyan: "bg-cyan text-bg",
    amber: "bg-amber text-bg",
    glass: "border border-volt/50 bg-bg/70 text-volt backdrop-blur-md",
  }[tone];
  return <span className={cn("pointer-events-none absolute z-30 rounded-md px-2 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] shadow-lg", cls, className)}>{children}</span>;
}

function Side({ src, alt, children }: { src: string; alt: string; children?: React.ReactNode }) {
  return (
    <div className="relative h-full w-full">
      <img src={src} alt={alt} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      {children}
    </div>
  );
}

export function BeforeAfter({
  beforeImage,
  afterImage,
  beforePose,
  afterPose,
  angles = [],
  verifyAngles,
  width,
  height,
  showSkeleton,
  showGhost,
  ghostPoints,
  pending,
  verifyPassed,
  verifying,
  momentT,
  afterLabel = "After · AI photo",
  maxHeight,
  className,
}: BeforeAfterProps) {
  const reduce = useReducedMotion();
  const mounted = useMounted();

  const ghost = useMemo(() => {
    if (!showGhost || afterImage) return null;
    if (ghostPoints?.length) return ghostPoints;
    return beforePose ? computeGhostPoints(beforePose, angles) : null;
  }, [showGhost, afterImage, ghostPoints, beforePose, angles]);

  const W = beforePose?.width ?? width;
  const H = beforePose?.height ?? height;
  const at = momentT != null ? ` · ${fmtTime(momentT)}` : "";

  // ── Slider (AI photo ready) ──
  if (afterImage) {
    return (
      <MediaFrame width={W} height={H} maxHeight={maxHeight} className={className} testId="before-after">
        {!mounted ? (
          <Side src={beforeImage} alt="Before: your form at the flagged moment" />
        ) : (
          <ReactCompareSlider
            className="h-full w-full"
            style={{ height: "100%", width: "100%" }}
            defaultPosition={reduce ? 50 : 100}
            keyboardIncrement="5%"
            aria-label="Before and after comparison"
            handle={<Handle intro />}
            itemOne={
              <Side src={beforeImage} alt="Before: your form at the flagged moment">
                <PoseOverlay pose={beforePose} angles={angles} visible={showSkeleton} width={W} height={H} />
              </Side>
            }
            itemTwo={
              <Side src={afterImage} alt="After: AI photo of the corrected form">
                <PoseOverlay pose={afterPose} angles={verifyAngles} visible={showSkeleton} width={W} height={H} variant="verified" showArrows={false} testId="pose-overlay-after" />
              </Side>
            }
          />
        )}
        <Chip tone="signal" className="left-7 top-3">
          Before{at}
        </Chip>
        <Chip tone="volt" className="right-7 top-3">
          <span className="sm:hidden">After</span>
          <span className="hidden sm:inline">{afterLabel}</span>
        </Chip>
        {(verifying || verifyPassed != null) && (
          <span
            className={cn(
              "pointer-events-none absolute bottom-3 right-7 z-30 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] backdrop-blur-md",
              verifying ? "border-cyan/50 bg-bg/70 text-cyan" : verifyPassed ? "border-volt/60 bg-bg/70 text-volt" : "border-amber/60 bg-bg/70 text-amber",
            )}
          >
            {verifying ? "Re-measuring…" : verifyPassed ? "✓ Verified by re-measure" : "! Close — not fully verified"}
          </span>
        )}
      </MediaFrame>
    );
  }

  // ── Your frame: measured skeleton (+ target ghost) (+ generating sweep) ──
  return (
    <MediaFrame width={W} height={H} maxHeight={maxHeight} className={className} testId="before-after">
      <Side src={beforeImage} alt={ghost ? "Your form at the flagged moment, with the target form drawn as a dashed skeleton" : "Your form at the flagged moment"}>
        {ghost && <div aria-hidden className="absolute inset-0 bg-bg/20" />}
        {beforePose && <PoseOverlay pose={beforePose} angles={angles} visible={showSkeleton} width={W} height={H} showArrows={!ghost} />}
        {ghost && <PoseOverlay points={ghost} width={W} height={H} variant="ghost" showArcs={false} visible delay={0.2} />}
      </Side>
      <Chip tone="signal" className="left-7 top-3">
        You{at}
      </Chip>
      {ghost && (
        <Chip tone="glass" className="right-7 top-3">
          Target · dashed
        </Chip>
      )}
      <AnimatePresence>
        {pending && (
          <motion.div
            key="gen"
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {!reduce && (
              <motion.div
                className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-volt/[0.14] to-transparent mix-blend-screen"
                animate={{ x: ["-110%", "230%"] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgb(198_255_61/0.035)_0px,rgb(198_255_61/0.035)_1px,transparent_1px,transparent_5px)]" />
          </motion.div>
        )}
      </AnimatePresence>
    </MediaFrame>
  );
}
