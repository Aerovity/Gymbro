// E2E test hooks. `window.__GYMBRO_TEST__.detect`, when present, replaces MediaPipe in lib/pose/detect.ts.
import type { PoseResult } from "@/lib/types";

declare global {
  interface GymBroTestHooks {
    /** Called instead of MediaPipe. `w`/`h` are the source pixel size; `mode` is the landmarker mode. */
    detect?: (
      source: unknown,
      w: number,
      h: number,
      mode: "image" | "video",
    ) => PoseResult | null | Promise<PoseResult | null>;
  }
  interface Window {
    __GYMBRO_TEST__?: GymBroTestHooks;
    __DEV_POSE__?: unknown;
  }
}

export {};
