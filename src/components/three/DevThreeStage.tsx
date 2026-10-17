"use client";
// Dev-only harness for the 3D replay: a synthetic push-up rep or the cached pull-up rep.
//   /dev/three?ex=push_up   (default)    /dev/three?ex=pull_up    …&single=1 (one frame, no rep)
import { useEffect, useMemo, useState } from "react";
import Form3DView from "./Form3DView";
import { PUSHUP_T_BOTTOM, syntheticPushupReport, syntheticPushupRep } from "./devPushupRep";
import { computeAngleReport } from "@/lib/angles/compute";
import type { RepFrame } from "@/lib/pose3d/skeleton3d";
import type { AngleReport, ExerciseId, Landmark, PoseResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type DevEx = "push_up" | "pull_up";

const PUSH_UP: ExerciseId = "push_up";

interface Loaded {
  frames: RepFrame[];
  world: Landmark[];
  report: AngleReport;
  t: number;
  exercise: ExerciseId;
}

function usePullupRep(enabled: boolean): Loaded | null | "error" {
  const [state, setState] = useState<Loaded | null | "error">(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    Promise.all([
      fetch("/demo/pullup/rep.json").then((r) => r.json() as Promise<{ t: number; frames: RepFrame[] }>),
      fetch("/demo/pullup/pose.json").then((r) => r.json() as Promise<PoseResult>),
    ])
      .then(([rep, pose]) => {
        if (!alive) return;
        setState({ frames: rep.frames, world: pose.worldLandmarks, report: computeAngleReport(pose, "pull_up"), t: rep.t, exercise: "pull_up" });
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return state;
}

export function DevThreeStage({ ex, single = false }: { ex: DevEx; single?: boolean }) {
  const pushup = useMemo<Loaded>(() => {
    const frames = syntheticPushupRep();
    const bottom = frames[Math.floor(frames.length / 2)];
    return { frames, world: bottom.world, report: syntheticPushupReport(PUSH_UP, frames), t: PUSHUP_T_BOTTOM, exercise: PUSH_UP };
  }, []);
  const pullup = usePullupRep(ex === "pull_up");
  const data = ex === "push_up" ? pushup : pullup;

  return (
    <main className="min-h-dvh bg-bg px-4 py-5 text-text sm:px-8 sm:py-8">
      <div className="mx-auto flex max-w-[880px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Dev · 3D replay</p>
            <h1 className="text-lg font-bold">{ex === "push_up" ? "Synthetic push-up (hips sag 15°)" : "Cached pull-up rep"}
              {single ? " · single frame" : ""}</h1>
          </div>
          <nav className="flex gap-2">
            {(["push_up", "pull_up"] as const).map((k) => (
              <a
                key={k}
                href={`/dev/three?ex=${k}`}
                className={cn(
                  "rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]",
                  k === ex ? "border-volt bg-volt text-bg" : "border-line text-dim hover:text-text",
                )}
              >
                {k === "push_up" ? "Push-up" : "Pull-up"}
              </a>
            ))}
          </nav>
        </header>
        {data === "error" ? (
          <p className="text-sm text-signal">Could not load /demo/pullup/rep.json.</p>
        ) : data ? (
          <Form3DView repFrames={single ? undefined : data.frames} world={data.world} report={data.report} tMoment={data.t} exercise={data.exercise} />
        ) : (
          <div className="shimmer flex h-[min(74vh,820px)] items-center justify-center rounded-2xl border border-line font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
            Loading rep…
          </div>
        )}
      </div>
    </main>
  );
}
