"use client";
/* eslint-disable @next/next/no-img-element */
// Before/after reveal: react-compare-slider with a PoseOverlay on both sides, an intro auto-sweep,
// a "generating" half-panel while the image edit runs, and a ghost-skeleton fallback when it fails.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ReactCompareSlider,
  useReactCompareSliderContext,
} from "react-compare-slider";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  WandSparkles,
} from "lucide-react";
import type { AngleMeasurement, ExerciseId, PoseResult, Pt } from "@/lib/types";
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
  /** Image edit is running. */
  pending?: boolean;
  afterFailed?: boolean;
  /** Ghost target skeleton in before-image pixel space (integrator may compute via ghostPose()). */
  ghostPoints?: Pt[];
  verifyPassed?: boolean;
  verifying?: boolean;
  momentT?: number;
  exercise?: ExerciseId;
  onRetryCorrect?: () => void;
  maxHeight?: string;
  className?: string;
}

const COPY: Partial<Record<ExerciseId, string[]>> & { default: string[] } = {
  pull_up: [
    "Leveling your shoulders…",
    "Rebuilding your elbows…",
    "Pulling your chin over the bar…",
    "Straightening your legs…",
    "Matching your gym's lighting…",
    "Keeping it you — same face, same kit…",
  ],
  squat: [
    "Dropping your hips below parallel…",
    "Stacking your knees over your toes…",
    "Flattening your back…",
    "Keeping it you — same face, same kit…",
  ],
  bench_press: [
    "Tucking your elbows to 60°…",
    "Stacking wrists over elbows…",
    "Pinning your shoulder blades…",
    "Keeping it you — same face, same kit…",
  ],
  deadlift: [
    "Flattening your back…",
    "Pulling the bar into your shins…",
    "Setting your hips…",
    "Keeping it you — same face, same kit…",
  ],
  overhead_press: [
    "Stacking the bar over your shoulders…",
    "Locking your ribs down…",
    "Keeping it you — same face, same kit…",
  ],
  biceps_curl: [
    "Pinning your elbows…",
    "Quieting your torso…",
    "Keeping it you — same face, same kit…",
  ],
  default: [
    "Rebuilding your form…",
    "Matching your gym's lighting…",
    "Keeping it you — same face, same kit…",
  ],
};

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
    const c = animate(100, 50, {
      duration: 0.8,
      delay: 0.35,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setPosition(v),
    });
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

function Chip({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone: "signal" | "volt" | "cyan" | "amber";
  className?: string;
}) {
  const cls = {
    signal: "bg-signal text-white",
    volt: "bg-volt text-bg",
    cyan: "bg-cyan text-bg",
    amber: "bg-amber text-bg",
  }[tone];
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-30 rounded-md px-2 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] shadow-lg",
        cls,
        className,
      )}
    >
      {children}
    </span>
  );
}

function Side({
  src,
  alt,
  children,
}: {
  src: string;
  alt: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative h-full w-full">
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
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
  pending,
  afterFailed,
  ghostPoints,
  verifyPassed,
  verifying,
  momentT,
  exercise,
  onRetryCorrect,
  maxHeight,
  className,
}: BeforeAfterProps) {
  const reduce = useReducedMotion();
  const mounted = useMounted();
  const lines = COPY[exercise ?? "default"] ?? COPY.default;
  const [lineIdx, setLineIdx] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(
      () => setLineIdx((i) => (i + 1) % lines.length),
      4000,
    );
    return () => clearInterval(id);
  }, [pending, lines.length]);

  const ghost = useMemo(() => {
    if (!afterFailed) return null;
    if (ghostPoints?.length) return ghostPoints;
    return beforePose ? computeGhostPoints(beforePose, angles) : null;
  }, [afterFailed, ghostPoints, beforePose, angles]);

  const W = beforePose?.width ?? width;
  const H = beforePose?.height ?? height;
  const beforeLabel = `Before${momentT != null ? ` · ${fmtTime(momentT)}` : ""}`;

  // ── Slider (after image ready) ──
  if (afterImage) {
    return (
      <MediaFrame
        width={W}
        height={H}
        maxHeight={maxHeight}
        className={className}
        testId="before-after"
      >
        {!mounted ? (
          <Side
            src={beforeImage}
            alt="Before: your form at the flagged moment"
          />
        ) : (
          <ReactCompareSlider
            className="h-full w-full"
            style={{ height: "100%", width: "100%" }}
            defaultPosition={reduce ? 50 : 100}
            keyboardIncrement="5%"
            aria-label="Before and after comparison"
            handle={<Handle intro />}
            itemOne={
              <Side
                src={beforeImage}
                alt="Before: your form at the flagged moment"
              >
                <PoseOverlay
                  pose={beforePose}
                  angles={angles}
                  visible={showSkeleton}
                  width={W}
                  height={H}
                />
              </Side>
            }
            itemTwo={
              <Side src={afterImage} alt="After: AI-corrected form">
                <PoseOverlay
                  pose={afterPose}
                  angles={verifyAngles}
                  visible={showSkeleton}
                  width={W}
                  height={H}
                  variant="verified"
                  showArrows={false}
                  testId="pose-overlay-after"
                />
              </Side>
            }
          />
        )}
        <Chip tone="signal" className="left-7 top-3">
          {beforeLabel}
        </Chip>
        <Chip tone="volt" className="right-7 top-3">
          After · corrected
        </Chip>
        {(verifying || verifyPassed != null) && (
          <span
            className={cn(
              "pointer-events-none absolute bottom-3 right-7 z-30 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] backdrop-blur-md",
              verifying
                ? "border-cyan/50 bg-bg/70 text-cyan"
                : verifyPassed
                  ? "border-volt/60 bg-bg/70 text-volt"
                  : "border-amber/60 bg-bg/70 text-amber",
            )}
          >
            {verifying
              ? "Re-measuring…"
              : verifyPassed
                ? "✓ Verified by re-measure"
                : "! Close — not fully verified"}
          </span>
        )}
      </MediaFrame>
    );
  }

  // ── Ghost fallback (image edit failed) ──
  if (afterFailed) {
    return (
      <MediaFrame
        width={W}
        height={H}
        maxHeight={maxHeight}
        className={className}
        testId="before-after"
      >
        <Side
          src={beforeImage}
          alt="Your form at the flagged moment with the target form ghost"
        >
          <div className="absolute inset-0 bg-bg/25" />
          <PoseOverlay
            pose={beforePose}
            angles={angles}
            visible={showSkeleton}
            width={W}
            height={H}
            showArrows={false}
          />
          {ghost && (
            <PoseOverlay
              points={ghost}
              width={W}
              height={H}
              variant="ghost"
              showArcs={false}
              visible
              delay={0.6}
            />
          )}
        </Side>
        <Chip tone="signal" className="left-7 top-3">
          {beforeLabel}
        </Chip>
        <Chip tone="volt" className="right-7 top-3">
          Target form · ghost
        </Chip>
        <div className="absolute inset-x-3 bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg/80 p-2.5 backdrop-blur-md">
          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-dim">
            <span className="font-semibold text-text">
              Corrected image unavailable.
            </span>{" "}
            Dashed volt = your target position.
          </span>
          {onRetryCorrect && (
            <button
              type="button"
              data-testid="retry-correct-btn"
              onClick={onRetryCorrect}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-volt px-3.5 text-[13px] font-bold text-bg transition-colors hover:bg-volt/85"
            >
              <RotateCcw className="size-4" aria-hidden /> Retry corrected image
            </button>
          )}
        </div>
      </MediaFrame>
    );
  }

  // ── Before only (+ generating panel while the edit runs) ──
  return (
    <MediaFrame
      width={W}
      height={H}
      maxHeight={maxHeight}
      className={className}
      testId="before-after"
    >
      <Side src={beforeImage} alt="Your form at the flagged moment">
        {beforePose && (
          <PoseOverlay
            pose={beforePose}
            angles={angles}
            visible={showSkeleton}
            width={W}
            height={H}
          />
        )}
      </Side>
      <Chip tone="signal" className="left-7 top-3">
        {beforeLabel}
      </Chip>
      <AnimatePresence>
        {pending && (
          <motion.div
            key="gen"
            className="pointer-events-none absolute inset-0 z-20"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            role="status"
            aria-live="polite"
          >
            {/* light pass sweeping over the frame */}
            {!reduce && (
              <motion.div
                aria-hidden
                className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-volt/[0.13] to-transparent mix-blend-screen"
                animate={{ x: ["-110%", "230%"] }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            )}
            <div
              aria-hidden
              className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgb(198_255_61/0.035)_0px,rgb(198_255_61/0.035)_1px,transparent_1px,transparent_5px)]"
            />
            <motion.div
              className="absolute inset-x-3 bottom-3 overflow-hidden rounded-xl border border-volt/40 bg-bg/80 p-3 backdrop-blur-md"
              initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
              animate={{ clipPath: "inset(0 0% 0 0)" }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-volt/15 text-volt ring-1 ring-volt/40">
                  <WandSparkles className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-[17px] uppercase leading-none tracking-wide text-text">
                      Generating corrected form
                    </span>
                    <span className="hidden shrink-0 font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim sm:inline">
                      GPT Image · ~20 s
                    </span>
                  </div>
                  <div className="mt-1 h-[18px] overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={lineIdx}
                        className="block truncate text-[12.5px] text-volt"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.25 }}
                      >
                        {lines[lineIdx % lines.length]}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className="h-full w-1/3 rounded-full bg-volt shadow-[0_0_8px_var(--color-volt)]"
                  animate={reduce ? undefined : { x: ["-100%", "300%"] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MediaFrame>
  );
}
