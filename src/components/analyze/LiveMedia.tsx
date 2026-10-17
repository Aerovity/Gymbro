"use client";
/* eslint-disable @next/next/no-img-element */
// The analyzing-screen player: the user's OWN clip (never a sample/poster) in broadcast chrome —
// scanning laser while the video model watches, a freeze + lower-third once the rep is found, and the
// skeleton drawing onto the flagged frame while the joints are measured. Neutral placeholder until the clip loads.
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ChosenMoment, PoseResult, Stage } from "@/lib/types";
import { TallyLight } from "@/components/shared/Broadcast";
import { MediaFrame } from "@/components/results/MediaFrame";
import { PoseOverlay } from "@/components/results/PoseOverlay";
import { FoundBanner } from "@/components/pipeline/FoundBanner";
import { fmtTime } from "@/components/shared/tokens";

export interface LiveMediaProps {
  videoUrl?: string;
  /** Rendered video size (sets the frame's aspect ratio). */
  width: number;
  height: number;
  stage: Stage;
  moment?: ChosenMoment;
  /** The cropped flagged frame + its pose (shown once the skeleton is mapped). */
  frameImage?: string;
  framePose?: PoseResult;
  framesDone: number;
  providerLabel?: string;
  maxHeight?: string;
  className?: string;
}

export function LiveMedia({ videoUrl, width, height, stage, moment, frameImage, framePose, framesDone, providerLabel, maxHeight, className }: LiveMediaProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const reading = stage === "idle" || stage === "probing" || stage === "sampling";
  const scanning = stage === "scanning";
  const picking = stage === "picking" || stage === "refining";
  const laser = reading || scanning || picking;
  const showFrame = !!(frameImage && framePose);
  const momentT = moment?.t;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (momentT != null) {
      v.pause();
      const seek = () => {
        try {
          v.currentTime = momentT;
        } catch {
          /* not seekable yet */
        }
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    } else {
      v.play().catch(() => {});
    }
  }, [momentT, videoUrl]);

  const chip = reading ? (
    <TallyLight tone="replay">
      {framesDone ? (
        <>
          <span className="sm:hidden">{framesDone} frames</span>
          <span className="hidden sm:inline">Reading · {framesDone} frames</span>
        </>
      ) : (
        "Reading your clip"
      )}
    </TallyLight>
  ) : scanning ? (
    <TallyLight tone="live">
      <span className="sm:hidden">Watching</span>
      <span className="hidden sm:inline">{(providerLabel ?? "NVIDIA video AI").replace(/ · cached$/, "")} watching</span>
    </TallyLight>
  ) : picking ? (
    <TallyLight tone="replay">Choosing the rep</TallyLight>
  ) : momentT != null ? (
    <TallyLight tone="live">Freeze · {fmtTime(momentT)}</TallyLight>
  ) : null;

  return (
    <MediaFrame width={width} height={height} maxHeight={maxHeight} className={className}>
      {videoUrl ? (
        <video
          ref={ref}
          src={videoUrl}
          muted
          playsInline
          loop
          autoPlay={momentT == null}
          preload="auto"
          aria-label="Your uploaded set"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-surface" aria-label="Loading your video" role="img">
          <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] bg-[size:12px_12px]" />
          <span className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-dim">Loading your clip…</span>
        </div>
      )}

      {/* The flagged frame, skeleton drawing on (object-cover + slice keep image and overlay aligned). */}
      <AnimatePresence>
        {showFrame && (
          <motion.div
            key="frame"
            className="absolute inset-0 z-10"
            initial={reduce ? false : { opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <img src={frameImage} alt="Your flagged frame" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-bg/15" />
            <PoseOverlay pose={framePose} showArcs={false} showArrows={false} preserveAspectRatio="xMidYMid slice" delay={0.25} testId="live-pose-overlay" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-black/45 via-transparent to-black/55" />

      <div className="absolute left-7 top-3 z-30">{chip}</div>

      {laser && videoUrl && (
        <>
          {scanning && (
            <div aria-hidden className="pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(0deg,rgb(46_230_255/0.05)_0px,rgb(46_230_255/0.05)_1px,transparent_1px,transparent_4px)]" />
          )}
          {!reduce && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-20 h-[2px] bg-cyan shadow-[0_0_18px_4px_var(--color-cyan)]"
              animate={{ top: ["4%", "96%", "4%"] }}
              transition={{ duration: scanning ? 3.2 : 4.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </>
      )}

      {moment && (
        <div className="absolute inset-x-3 bottom-4 z-30">
          <FoundBanner moment={moment} providerLabel={providerLabel} size="sm" />
        </div>
      )}
    </MediaFrame>
  );
}
