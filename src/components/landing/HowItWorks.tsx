"use client";
// "How it works": Watch → Measure → Coach → Show → Verify, revealed on scroll with a stagger.
import { motion, useReducedMotion } from "motion/react";
import { BadgeCheck, Bone, Eye, MessageSquare, WandSparkles } from "lucide-react";
import { Eyebrow } from "@/components/shared/Broadcast";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: "01", title: "Watch", model: "NVIDIA Cosmos · Nemotron", body: "A video model watches the whole set and timestamps the rep where your form broke.", Icon: Eye, tone: "nvidia" as const, stat: "FOUND 0:07" },
  { n: "02", title: "Measure", model: "MediaPipe Pose", body: "33 landmarks on the exact frame. Every joint angle, against evidence-based targets.", Icon: Bone, tone: "cyan" as const, stat: "ELBOW 98°" },
  { n: "03", title: "Coach", model: "GPT", body: "A coach that quotes your numbers back to you, with cues and a drill for next set.", Icon: MessageSquare, tone: "text" as const, stat: "3 CUES" },
  { n: "04", title: "Show", model: "GPT Image", body: "You, in your gym, doing it right — an identity-preserving corrected frame.", Icon: WandSparkles, tone: "text" as const, stat: "AFTER" },
  { n: "05", title: "Verify", model: "Re-measure", body: "We run the pose model again on the corrected image to prove the fix lands in range.", Icon: BadgeCheck, tone: "volt" as const, stat: "62° ✓" },
];

const TONE = {
  nvidia: "text-[#9be22d] bg-nvidia/12 ring-nvidia/40",
  cyan: "text-cyan bg-cyan/10 ring-cyan/30",
  text: "text-text bg-white/5 ring-white/15",
  volt: "text-volt bg-volt/10 ring-volt/40",
};

export function HowItWorks() {
  const reduce = useReducedMotion();
  return (
    <section id="how" className="mx-auto max-w-[1320px] scroll-mt-20 px-5 py-20 sm:px-8 lg:py-28">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 font-display text-[clamp(40px,5.5vw,72px)] uppercase leading-[0.92] text-text">
            Watch. Measure. Coach.
            <br />
            <span className="text-dim">Show.</span> <span className="text-volt">Verify.</span>
          </h2>
        </div>
        <p className="max-w-sm text-[15px] leading-relaxed text-dim">Five models, one pipeline, about 30 seconds. Every number on screen is measured — not guessed.</p>
      </div>

      <ol className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div aria-hidden className="absolute left-0 right-0 top-[52px] hidden h-px bg-gradient-to-r from-nvidia/60 via-cyan/40 to-volt/60 lg:block" />
        {STEPS.map((s, i) => (
          <motion.li
            key={s.n}
            initial={reduce ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
            className="group relative flex flex-col rounded-2xl border border-line bg-surface/80 p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-colors duration-200 hover:border-white/15"
          >
            <div className="flex items-center justify-between">
              <span className={cn("relative z-10 flex size-12 items-center justify-center rounded-xl ring-1", TONE[s.tone])}>
                <s.Icon className="size-[22px]" aria-hidden />
              </span>
              <span className="font-mono text-[12px] tabular text-dim">{s.n}</span>
            </div>
            <h3 className="mt-5 font-display text-[32px] uppercase leading-none text-text">{s.title}</h3>
            <div className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">{s.model}</div>
            <p className="mt-3 flex-1 text-[14px] leading-relaxed text-dim">{s.body}</p>
            <div className={cn("mt-5 inline-flex w-fit rounded-md px-2 py-1 font-mono text-[11px] font-bold tabular tracking-wider ring-1", TONE[s.tone])}>{s.stat}</div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
