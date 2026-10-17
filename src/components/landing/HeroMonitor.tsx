"use client";
/* eslint-disable @next/next/no-img-element */
// Hero "monitor": a frozen frame of the bad rep with an animated telestrator skeleton.
// Uses the cached demo fixtures (/demo/pullup/frame.jpg, pose.json, meta.json, scan.json, after-pose.json)
// when present — angles are measured live with computeAngleReport — else a bundled mock.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { AngleMeasurement, ChosenMoment, PoseResult, ScanEvent } from "@/lib/types";
import { demoAsset } from "@/lib/exercises/catalog";
import { computeAngleReport } from "@/lib/angles/compute";
import { TallyLight } from "@/components/shared/Broadcast";
import { buildPose, PULLUP_BEFORE_PX } from "@/components/shared/poseBuilder";
import { fmtValue, gradeColor } from "@/components/shared/tokens";
import { MediaFrame } from "@/components/results/MediaFrame";
import { PoseOverlay } from "@/components/results/PoseOverlay";
import { ProviderBadge } from "@/components/results/ProviderBadge";
import { FoundBanner } from "@/components/pipeline/FoundBanner";

interface HeroData {
  img: string;
  pose: PoseResult;
  angles: AngleMeasurement[];
  moment: ChosenMoment;
  score: number;
  grade: "A" | "B" | "C" | "D";
  fix?: { label: string; before: string; after: string };
}

const MOCK: HeroData = {
  img: "/landing/hero-frame.jpg",
  pose: buildPose(1024, 1536, PULLUP_BEFORE_PX),
  angles: [
    { key: "elbow_top", label: "Elbow", value: 98, unit: "°", points: [12, 14, 16], reliable: true, target: { max: 75, ideal: 60 }, status: "bad", deviation: 23 },
    { key: "knee_angle", label: "Knee", value: 128, unit: "°", points: [23, 25, 27], reliable: true, target: { min: 150, ideal: 175 }, status: "bad", deviation: 22 },
  ],
  moment: { t: 7, source: "demo", event: { t_start: 6.6, t_peak: 7.2, t_end: 7.6, rep_index: 2, issue: "Partial range at top", body_part: "elbows", severity: 4, confidence: 0.86, description: "" } },
  score: 60,
  grade: "C",
  fix: { label: "Elbow", before: "98°", after: "62°" },
};

function isPose(v: unknown): v is PoseResult {
  const p = v as PoseResult;
  return !!p && Array.isArray(p.landmarks) && p.landmarks.length >= 29 && typeof p.width === "number" && typeof p.height === "number";
}
const getJson = async (u: string): Promise<unknown> => {
  const r = await fetch(u, { cache: "force-cache" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};
const loads = (src: string) =>
  new Promise<boolean>((res) => {
    const i = new Image();
    i.onload = () => res(true);
    i.onerror = () => res(false);
    i.src = src;
  });

export function HeroMonitor() {
  const reduce = useReducedMotion();
  const [d, setD] = useState<HeroData>(MOCK);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [poseJ, meta, scan] = await Promise.all([
          getJson(demoAsset("pullup", "pose.json")),
          getJson(demoAsset("pullup", "meta.json")).catch(() => null) as Promise<{ t?: number; refinedFrom?: number } | null>,
          getJson(demoAsset("pullup", "scan.json")).catch(() => null) as Promise<{ events?: ScanEvent[] } | null>,
        ]);
        if (!isPose(poseJ)) return;
        const img = demoAsset("pullup", "frame.jpg");
        if (!(await loads(img))) return;
        const report = computeAngleReport(poseJ, "pull_up");
        const t = meta?.t ?? 7;
        const peak = meta?.refinedFrom ?? t;
        const event = scan?.events?.slice().sort((a, b) => Math.abs(a.t_peak - peak) - Math.abs(b.t_peak - peak))[0];
        let fix: HeroData["fix"];
        const v = report.violations[0];
        const after = await getJson(demoAsset("pullup", "after-pose.json")).catch(() => null);
        if (v && isPose(after)) {
          const ar = computeAngleReport(after, "pull_up");
          const am = ar.angles.find((a) => a.key === v.angleKey);
          const bm = report.angles.find((a) => a.key === v.angleKey);
          if (am?.value != null && bm) fix = { label: bm.label, before: fmtValue(bm.value, bm.unit), after: fmtValue(am.value, am.unit) };
        }
        if (alive) setD({ img, pose: poseJ, angles: report.angles, moment: { t, source: "demo", refinedFrom: meta?.refinedFrom, event }, score: report.score, grade: report.grade, fix });
      } catch {
        /* keep mock */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rep = d.moment.event?.rep_index;
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div aria-hidden className="absolute -inset-10 rounded-[40px] bg-[radial-gradient(closest-side,rgb(46_230_255/0.18),transparent)] blur-2xl" />
      <motion.div initial={reduce ? false : { opacity: 0, y: 16, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}>
        <MediaFrame width={d.pose.width} height={d.pose.height} maxHeight="min(68vh, 640px)" className="ring-1 ring-white/5">
          <img src={d.img} alt="Pull-up frame flagged by the video model" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
          <PoseOverlay key={d.img} pose={d.pose} angles={d.angles} delay={0.4} />
          <div className="absolute left-3 right-3 top-3 z-30 flex items-center justify-between gap-2">
            <TallyLight tone="live">{rep != null ? `Rep ${rep} · Freeze` : "Freeze frame"}</TallyLight>
            <ProviderBadge provider="NVIDIA video AI" size="xs" />
          </div>
          <div className="absolute inset-x-3 bottom-4 z-30">
            <FoundBanner key={d.moment.t} moment={d.moment} />
          </div>
        </MediaFrame>
      </motion.div>

      <motion.div
        initial={reduce ? false : { opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.4, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="absolute -left-6 top-[34%] z-30 hidden rounded-2xl border border-line bg-surface/90 p-3 pr-4 shadow-2xl backdrop-blur-md sm:block xl:-left-16"
      >
        <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-dim">Form score</div>
        <div className="mt-1 flex items-end gap-2">
          <span className="font-display text-[44px] leading-none text-text">{d.score}</span>
          <span className="mb-1 flex size-7 items-center justify-center rounded-md border-2 font-display text-lg leading-none" style={{ borderColor: gradeColor(d.grade), color: gradeColor(d.grade) }}>
            {d.grade}
          </span>
        </div>
      </motion.div>

      {d.fix && (
        <motion.div
          initial={reduce ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 1.8, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute -right-4 top-[58%] z-30 hidden rounded-2xl border border-volt/40 bg-surface/90 p-3 pr-4 shadow-2xl backdrop-blur-md sm:block xl:-right-14"
        >
          <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-dim">{d.fix.label} · verified fix</div>
          <div className="mt-1 font-mono text-[22px] font-bold tabular text-volt">
            {d.fix.before} <span className="text-dim">→</span> {d.fix.after} ✓
          </div>
        </motion.div>
      )}
    </div>
  );
}
