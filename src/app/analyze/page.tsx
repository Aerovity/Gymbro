"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AnalyzeView } from "@/components/analyze/AnalyzeView";
import { usePipelineStore, type StepId } from "@/lib/store/pipeline";
import { abortPipeline, getLastInput, pickOtherMoment, retryCorrect, startPipeline, takePendingStart } from "@/hooks/usePipeline";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { ghostPose } from "@/lib/angles/ghost";
import { computeAngleReport } from "@/lib/angles/compute";
import { exportBeforeAfter } from "@/lib/render/drawOverlay";
import { DEMO_CLIPS, EXERCISE_INFO } from "@/lib/exercises/catalog";
import type { DemoId } from "@/lib/types";

let leaveTimer: ReturnType<typeof setTimeout> | undefined;

const fileName = () => `gym-bro-${usePipelineStore.getState().resolvedExercise ?? "set"}.png`;

async function exportPng(): Promise<Blob> {
  const s = usePipelineStore.getState();
  if (!s.beforeImage) throw new Error("Nothing to export yet");
  const ex = s.resolvedExercise ?? "pull_up";
  const afterReport = s.afterPose ? computeAngleReport(s.afterPose, ex) : null;
  return exportBeforeAfter(s.beforeImage, s.afterImage ?? s.beforeImage, [s.beforePose, s.afterPose ?? null], [s.angles, afterReport], {
    score: s.score,
    grade: s.angles?.grade,
    afterScore: afterReport?.score,
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
  const demoParam = params.get("demo") as DemoId | null;
  const live = params.get("live") === "1";

  // Start once: a pending upload handed over from the landing page, or ?demo=<id>.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = takePendingStart();
    const clip = DEMO_CLIPS.find((d) => d.id === demoParam);
    if (pending) void startPipeline(pending);
    else if (clip) void startPipeline({ demoId: clip.id, exercise: clip.exercise, live });
    else router.replace("/");
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

  const ghostPoints = useMemo(
    () => (data.afterFailed && data.beforePose && data.angles ? ghostPose(data.beforePose, data.angles) : undefined),
    [data.afterFailed, data.beforePose, data.angles],
  );

  const onRetryStep = useCallback((stepId: StepId) => {
    if (stepId === "correct" || stepId === "verify") {
      void retryCorrect();
      return;
    }
    const last = getLastInput();
    if (last) void startPipeline(last);
  }, []);

  const onUseDemo = useCallback(() => {
    router.replace("/analyze?demo=pullup");
    void startPipeline({ demoId: "pullup", exercise: "pull_up" });
  }, [router]);

  const onStartOver = useCallback(() => {
    abortPipeline();
    usePipelineStore.getState().reset();
    router.push("/");
  }, [router]);

  return (
    <AnalyzeView
      data={data}
      onToggleSkeleton={data.toggleSkeleton}
      onToggleVoice={data.toggleVoice}
      onRetryStep={onRetryStep}
      onUseDemo={onUseDemo}
      onRetryCorrect={() => void retryCorrect()}
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
