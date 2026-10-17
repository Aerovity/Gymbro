"use client";
// Landing hero: darkened looping demo tape, scoreboard H1, CTAs and the telestrator monitor.
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Play } from "lucide-react";
import { DEMO_CLIPS } from "@/lib/exercises/catalog";
import { Kbd, TallyLight } from "@/components/shared/Broadcast";
import { HeroMonitor } from "./HeroMonitor";

export interface HeroProps {
  onAnalyse: () => void;
  onSample: () => void;
}

const STATS = [
  { k: "33", v: "joint landmarks" },
  { k: "5", v: "AI steps, one verdict" },
  { k: "1", v: "re-measured fix" },
];

export function Hero({ onAnalyse, onSample }: HeroProps) {
  const reduce = useReducedMotion();
  const clip = DEMO_CLIPS[0];
  const rise = (d: number) => (reduce ? { initial: false as const } : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: d, ease: [0.2, 0.8, 0.2, 1] as const } });

  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      {/* Background tape */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <video src={clip.video} poster={clip.poster} autoPlay muted loop playsInline preload="auto" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-[2px] brightness-[0.55] saturate-[0.6]" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/60" />
        <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.03)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.03)_1px,transparent_1px)] bg-[size:8px_8px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_70%_40%,transparent,rgb(7_9_12/0.8))]" />
      </div>

      <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 pb-16 pt-10 sm:px-8 lg:min-h-[calc(100svh-72px)] lg:grid-cols-[1.2fr_0.8fr] lg:gap-8 lg:py-12">
        <div className="min-w-0">
          <motion.div {...rise(0)}>
            <TallyLight tone="live">Live · video agent</TallyLight>
          </motion.div>
          <motion.h1 {...rise(0.05)} className="mt-6 font-display text-[clamp(50px,6.7vw,108px)] uppercase leading-[0.9] tracking-[0.005em] text-text">
            Your AI spotter
            <br />
            watches <span className="relative inline-block text-volt [text-shadow:0_0_40px_rgb(198_255_61/0.35)]">
              the tape.
              <svg aria-hidden viewBox="0 0 300 24" preserveAspectRatio="none" className="absolute -bottom-[0.12em] left-0 h-[0.16em] w-full overflow-visible">
                <motion.path d="M4 16 Q 80 4 150 12 T 296 8" fill="none" stroke="#ff3b5c" strokeWidth="6" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.7, duration: 0.6, ease: "easeInOut" }} />
              </svg>
            </span>
          </motion.h1>
          <motion.p {...rise(0.15)} className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim sm:text-lg">
            Upload a set. <span className="font-semibold text-text">NVIDIA video AI</span> finds the bad rep. We measure every joint, coach the fix, and show you doing it right.
          </motion.p>
          <motion.div {...rise(0.22)} className="mt-9 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onAnalyse}
              className="group inline-flex h-14 cursor-pointer items-center gap-2.5 rounded-2xl bg-volt px-7 text-base font-bold text-bg shadow-[var(--shadow-glow-volt)] transition-all duration-200 hover:shadow-[0_0_40px_rgb(198_255_61/0.55)]"
            >
              Analyse my lift
              <ArrowRight className="size-5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onSample}
              className="inline-flex h-14 cursor-pointer items-center gap-2.5 rounded-2xl border border-white/15 bg-white/[0.04] px-6 text-base font-semibold text-text backdrop-blur transition-colors duration-200 hover:border-white/30 hover:bg-white/[0.08]"
            >
              <Play className="size-4 fill-current" aria-hidden />
              Try a sample
            </button>
            <span className="hidden items-center gap-2 text-sm text-dim sm:inline-flex">
              or press <Kbd>D</Kbd> for the demo
            </span>
          </motion.div>
          <motion.dl {...rise(0.3)} className="mt-12 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
            {STATS.map((s) => (
              <div key={s.v}>
                <dt className="sr-only">{s.v}</dt>
                <dd className="font-display text-4xl leading-none text-text">{s.k}</dd>
                <dd className="mt-1.5 font-mono text-[10.5px] uppercase leading-4 tracking-[0.14em] text-dim">{s.v}</dd>
              </div>
            ))}
          </motion.dl>
        </div>
        <div className="min-w-0 px-4 sm:px-10 lg:px-0">
          <HeroMonitor />
        </div>
      </div>
    </section>
  );
}
