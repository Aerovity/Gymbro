"use client";
// Main media viewer before the canonical "before" frame exists: the uploaded clip with broadcast
// chrome (sampling / Cosmos watching / found lower-third), or the before frame while the skeleton maps.
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ChosenMoment, Stage } from "@/lib/types";
import { TallyLight } from "@/components/shared/Broadcast";
import { MediaFrame } from "@/components/results/MediaFrame";
import { FoundBanner } from "@/components/pipeline/FoundBanner";

export interface LiveMediaProps {
  videoUrl?: string;
  width: number;
  height: number;
  stage: Stage;
  moment?: ChosenMoment;
  framesDone: number;
  framesExpected: number;
  providerLabel?: string;
  maxHeight?: string;
}

export function LiveMedia({ videoUrl, width, height, stage, moment, framesDone, framesExpected, providerLabel, maxHeight }: LiveMediaProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const scanning = stage === "scanning";
  const sampling = stage === "probing" || stage === "sampling";

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (moment) {
      v.pause();
      const seek = () => {
        try {
          v.currentTime = moment.t;
        } catch {
          /* not seekable yet */
        }
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    } else {
      v.play().catch(() => {});
    }
  }, [moment]);

  return (
    <MediaFrame width={width} height={height} maxHeight={maxHeight}>
      {videoUrl ? (
        <video ref={ref} src={videoUrl} muted playsInline loop autoPlay={!moment} preload="auto" aria-label="Your uploaded set" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="shimmer absolute inset-0" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />

      {/* status chip */}
      <div className="absolute left-7 top-3 z-30 flex flex-col items-start gap-2">
        {sampling && <TallyLight tone="replay">Sampling {framesDone}/{framesExpected}</TallyLight>}
        {scanning && <TallyLight tone="live">{providerLabel ?? "NVIDIA AI"} watching</TallyLight>}
        {moment && <TallyLight tone="live">Freeze · {moment.t.toFixed(1)}s</TallyLight>}
      </div>

      {scanning && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgb(46_230_255/0.06)_0px,rgb(46_230_255/0.06)_1px,transparent_1px,transparent_4px)]" />
          {!reduce && (
            <motion.div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-[2px] bg-cyan shadow-[0_0_18px_4px_var(--color-cyan)]" animate={{ top: ["4%", "96%", "4%"] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} />
          )}
        </>
      )}

      {moment && (
        <div className="absolute inset-x-3 bottom-4 z-30">
          <FoundBanner moment={moment} providerLabel={providerLabel} />
        </div>
      )}
    </MediaFrame>
  );
}
