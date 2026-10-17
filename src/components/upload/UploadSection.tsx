"use client";
// Upload section (push-ups & pull-ups): dropzone + exercise picker + camera hint + the cached sample.
import { useState } from "react";
import type { DemoId, ExerciseChoice } from "@/lib/types";
import { Eyebrow } from "@/components/shared/Broadcast";
import { Dropzone } from "./Dropzone";
import { ExercisePicker } from "./ExercisePicker";
import { CameraViewHint } from "./CameraViewHint";
import { SampleClips } from "./SampleClips";

export interface UploadSectionProps {
  exercise: ExerciseChoice;
  onExercise: (v: ExerciseChoice) => void;
  onFile: (f: File) => void;
  onDemo: (id: DemoId) => void;
}

const MAX = 200 * 1024 * 1024;

export function validateVideo(f: File): string | null {
  if (!f.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) return "That's not a video file — upload an MP4 or MOV from your camera roll.";
  if (f.size > MAX) return "That file is over 200 MB — trim it to just the set (5–20 s) and try again.";
  return null;
}

export function UploadSection({ exercise, onExercise, onFile, onDemo }: UploadSectionProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section id="upload" className="relative scroll-mt-16 border-t border-line">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_50%_100%_at_50%_0%,rgb(198_255_61/0.06),transparent)]" />
      <div className="relative mx-auto max-w-[1320px] px-5 py-20 sm:px-8 lg:py-24">
        <Eyebrow>Your turn</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(40px,5.5vw,72px)] uppercase leading-[0.92] text-text">
          Put your set <span className="text-volt">on tape.</span>
        </h2>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-dim">
          Upload a set of <span className="font-semibold text-text">push-ups or pull-ups</span>. NVIDIA video AI finds the rep to fix, we measure every joint on that frame, and your coach tells you exactly what to change.
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Dropzone
            error={error}
            onFile={(f) => {
              const e = validateVideo(f);
              setError(e);
              if (!e) onFile(f);
            }}
            className="h-full"
          />
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">Exercise</div>
              <ExercisePicker value={exercise} onChange={onExercise} />
            </div>
            <CameraViewHint exercise={exercise} />
            <div>
              <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">No clip handy? Try ours</div>
              <SampleClips onPick={onDemo} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
