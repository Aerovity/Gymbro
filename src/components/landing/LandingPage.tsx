"use client";
// Landing page composition. Press D anywhere (outside inputs) to open the cached pull-up sample.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DemoId, ExerciseChoice } from "@/lib/types";
import { DEMO_CLIPS } from "@/lib/exercises/catalog";
import { useStartAnalysis } from "@/hooks/useStartAnalysis";
import { Kbd, Wordmark } from "@/components/shared/Broadcast";
import { UploadSection } from "@/components/upload/UploadSection";
import { Hero } from "./Hero";
import { PoweredBy } from "./PoweredBy";
import { HowItWorks } from "./HowItWorks";

export function LandingPage() {
  const start = useStartAnalysis();
  const [exercise, setExercise] = useState<ExerciseChoice>("auto");

  const runDemo = useCallback(
    (id: DemoId = "pullup") => {
      const clip = DEMO_CLIPS.find((c) => c.id === id);
      start({ demoId: id, exercise: clip?.exercise ?? "auto" });
    },
    [start],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      runDemo("pullup");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runDemo]);

  const scrollToUpload = () => document.getElementById("upload")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-50 border-b border-line/70 bg-bg/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-[72px] max-w-[1320px] items-center gap-6 px-5 sm:px-8" aria-label="Main">
          <Link href="/" aria-label="Gym Bro home" className="rounded-lg">
            <Wordmark />
          </Link>
          <div className="ml-auto hidden items-center gap-1 md:flex">
            <a href="#how" className="rounded-lg px-3 py-2 text-sm font-medium text-dim transition-colors hover:text-text">
              How it works
            </a>
            <a href="#upload" className="rounded-lg px-3 py-2 text-sm font-medium text-dim transition-colors hover:text-text">
              Upload
            </a>
          </div>
          <button type="button" onClick={() => runDemo("pullup")} className="ml-auto inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-4 text-sm font-semibold text-text transition-colors hover:border-volt/50 md:ml-0">
            Try the sample <Kbd>D</Kbd>
          </button>
        </nav>
      </header>
      <main className="flex-1">
        <Hero onAnalyse={scrollToUpload} onSample={() => runDemo("pullup")} />
        <PoweredBy />
        <HowItWorks />
        <UploadSection exercise={exercise} onExercise={setExercise} onFile={(file) => start({ file, exercise })} onDemo={runDemo} />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-col items-center justify-between gap-3 px-5 py-8 text-[13px] text-dim sm:flex-row sm:px-8">
          <Wordmark className="scale-90" />
          <p>Built with NVIDIA video AI for the VAST London Real-Time Video Agents Hack. Not medical advice.</p>
        </div>
      </footer>
    </div>
  );
}
