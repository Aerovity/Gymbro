"use client";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AnalyzeView } from "@/components/analyze/AnalyzeView";
import { usePipelineStore } from "@/lib/store/pipeline";
import {
  abortPipeline,
  generateAiPhoto,
  getLastInput,
  pickOtherMoment,
  reanalyseAs,
  startPipeline,
  takePendingStart,
} from "@/hooks/usePipeline";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { ghostPose } from "@/lib/angles/ghost";
import { computeAngleReport } from "@/lib/angles/compute";
import { exportBeforeAfter } from "@/lib/render/drawOverlay";
import { DEMO_CLIPS, EXERCISE_INFO } from "@/lib/exercises/catalog";
import type { AngleReport, ExerciseId, PoseResult } from "@/lib/types";

let leaveTimer: ReturnType<typeof setTimeout> | undefined;

const fileName = () => `gym-bro-${usePipelineStore.getState().resolvedExercise ?? "set"}.png`;

/** The target ("ghost") skeleton as a PoseResult in the before image's space. */
function ghostAsPose(pose: PoseResult, report: AngleReport): PoseResult {
  const pts = ghostPose(pose, report);
  return {
    ...pose,
    landmarks: pose.landmarks.map((l, i) => ({ ...l, x: pts[i].x / pose.width, y: pts[i].y / pose.height })),
  };
}

/** BEFORE | AFTER card: the AI photo when there is one, else the user's frame with the target skeleton. */
async function exportPng(): Promise<Blob> {
  const s = usePipelineStore.getState();
  const ex = s.resolvedExercise;
  if (!s.beforeImage || !ex) throw new Error("Nothing to export yet");
  const photo = !!s.afterImage;
  const afterPose = photo ? s.afterPose : s.beforePose && s.angles ? ghostAsPose(s.beforePose, s.angles) : undefined;
  const afterReport = afterPose ? computeAngleReport(afterPose, ex) : null;
  return exportBeforeAfter(s.beforeImage, s.afterImage ?? s.beforeImage, [s.beforePose, afterPose], [s.angles, afterReport], {
    score: s.score,
    grade: s.angles?.grade,
    // Only a re-measured photo has an "after" score; the target skeleton is a goal, not a measurement.
    afterScore: photo ? afterReport?.score : undefined,
    subtitle: [EXERCISE_INFO[ex].label, s.coach?.headline].filter(Boolean).join(" · "),
  });
}

async function download() {
  try {
    const url = URL.createObjectURL(await exportPng());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    toast.error("Couldn't export the image", { description: String(e) });
  }
}

async function share() {
  try {
    const blob = await exportPng();
    const file = new File([blob], fileName(), { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Gym Bro form check" });
      return;
    }
    if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Result card copied to clipboard");
      return;
    }
    await download();
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return;
    toast.error("Sharing failed", { description: String(e) });
  }
}

function AnalyzeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const data = usePipelineStore();
  const started = useRef(false);
  // Nothing renders until this page has started its own run, so a previous run can never flash.
  const [ready, setReady] = useState(false);
  const demoParam = params.get("demo");
  const live = params.get("live") === "1";

  // Start once, before the first paint: a pending upload handed over from the landing page (its store
  // state was already reset by setPendingStart), or ?demo=<id> (startPipeline resets synchronously).
  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = takePendingStart();
    const clip = DEMO_CLIPS.find((d) => d.id === demoParam);
    if (pending) void startPipeline(pending);
    else if (clip) void startPipeline({ demoId: clip.id, exercise: clip.exercise, live });
    else {
      router.replace("/");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time gate flipped before paint
    setReady(true);
  }, [demoParam, live, router]);

  // Abort in-flight work when leaving the page. Deferred so React StrictMode's dev-only
  // unmount→remount doesn't kill the run that was just started.
  useEffect(() => {
    clearTimeout(leaveTimer);
    return () => {
      leaveTimer = setTimeout(abortPipeline, 0);
    };
  }, []);

  // S toggles skeleton & angles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") usePipelineStore.getState().toggleSkeleton();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useCoachVoice();

  // Target skeleton on the user's frame — shown by default (the AI photo is optional).
  const ghostPoints = useMemo(
    () => (data.beforePose && data.angles ? ghostPose(data.beforePose, data.angles) : undefined),
    [data.beforePose, data.angles],
  );

  const onRetryStep = useCallback(() => {
    const last = getLastInput();
    if (last) void startPipeline(last);
  }, []);

  const onUseDemo = useCallback(() => {
    router.replace("/analyze?demo=pullup");
    void startPipeline({ demoId: "pullup", exercise: "pull_up" });
  }, [router]);

  const onChangeExercise = useCallback((ex: ExerciseId) => void reanalyseAs(ex), []);

  const onStartOver = useCallback(() => {
    abortPipeline();
    usePipelineStore.getState().reset();
    router.push("/");
  }, [router]);

  if (!ready) return null;

  return (
    <AnalyzeView
      data={data}
      onToggleSkeleton={data.toggleSkeleton}
      onToggleVoice={data.toggleVoice}
      onRetryStep={onRetryStep}
      onUseDemo={onUseDemo}
      onGenerateAiPhoto={() => void generateAiPhoto()}
      onChangeExercise={onChangeExercise}
      onPickOtherMoment={() => void pickOtherMoment()}
      onStartOver={onStartOver}
      onSeek={() => undefined}
      onDownload={() => void download()}
      onShare={() => void share()}
      ghostPoints={ghostPoints}
      models={{ pose: "MediaPipe pose_landmarker_heavy", scan: data.scan?.model ?? "—" }}
    />
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={null}>
      <AnalyzeInner />
    </Suspense>
  );
}
