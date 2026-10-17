"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DemoId, ExerciseChoice } from "@/lib/types";
import { setPendingStart } from "./usePipeline";
import { preloadPose } from "@/lib/pose/landmarker";

export interface StartAnalysisInput {
  file?: File;
  demoId?: DemoId;
  exercise: ExerciseChoice;
}

/** Hands the chosen file/demo to the analyze page and navigates there. */
export function useStartAnalysis(): (input: StartAnalysisInput) => void {
  const router = useRouter();
  return useCallback(
    (input: StartAnalysisInput) => {
      void preloadPose().catch(() => undefined);
      if (input.demoId && !input.file) {
        router.push(`/analyze?demo=${input.demoId}`);
        return;
      }
      setPendingStart(input);
      router.push("/analyze");
    },
    [router],
  );
}
