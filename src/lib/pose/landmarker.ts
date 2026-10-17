// MediaPipe PoseLandmarker singletons (browser only). The library is dynamically imported
// so it never runs on the server. Local wasm/models → CDN/Google fallback, GPU → CPU fallback.
import type { PoseLandmarker } from "@mediapipe/tasks-vision";

export const MP_VERSION = "1.1.1";
export const LOCAL_WASM = "/mediapipe/wasm";
export const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
export const LOCAL_MODEL = { heavy: "/models/pose_landmarker_heavy.task", lite: "/models/pose_landmarker_lite.task" } as const;
export const REMOTE_MODEL = {
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
} as const;
export const LOAD_TIMEOUT_MS = 20_000;

export type ModelVariant = keyof typeof LOCAL_MODEL;
export type Mode = "IMAGE" | "VIDEO";

export interface LandmarkerInfo {
  mode: Mode;
  model: ModelVariant;
  delegate: "GPU" | "CPU";
  wasm: "local" | "cdn";
  modelSource: "local" | "remote";
  ms: number;
  attempts: string[]; // failures before success, e.g. "local/GPU: Error …"
}

export class PoseModelError extends Error {
  constructor(message: string, public readonly attempts: string[]) {
    super(message);
    this.name = "PoseModelError";
  }
}

const cache: Partial<Record<Mode, Promise<PoseLandmarker>>> = {};
const info: Partial<Record<Mode, LandmarkerInfo>> = {};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(to);
        resolve(v);
      },
      (e) => {
        clearTimeout(to);
        reject(e);
      },
    );
  });
}

async function create(mode: Mode, model: ModelVariant): Promise<PoseLandmarker> {
  if (typeof window === "undefined") throw new PoseModelError("Pose landmarker is browser-only", []);
  const t0 = performance.now();
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const plans = [
    { wasm: "local", modelSource: "local", delegate: "GPU" },
    { wasm: "local", modelSource: "local", delegate: "CPU" },
    { wasm: "cdn", modelSource: "remote", delegate: "GPU" },
    { wasm: "cdn", modelSource: "remote", delegate: "CPU" },
  ] as const;
  const deadline = t0 + LOAD_TIMEOUT_MS;
  const attempts: string[] = [];
  for (const plan of plans) {
    // Keep at least a few seconds for the CDN path even if local attempts were slow.
    const budget = Math.max(5000, deadline - performance.now());
    try {
      const lm = await withTimeout(
        (async () => {
          const fileset = await FilesetResolver.forVisionTasks(plan.wasm === "local" ? LOCAL_WASM : CDN_WASM);
          return PoseLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: plan.modelSource === "local" ? LOCAL_MODEL[model] : REMOTE_MODEL[model],
              delegate: plan.delegate,
            },
            runningMode: mode,
            numPoses: 2,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: false,
          });
        })(),
        budget,
        `${plan.wasm}/${plan.delegate}`,
      );
      info[mode] = {
        mode,
        model,
        delegate: plan.delegate,
        wasm: plan.wasm,
        modelSource: plan.modelSource,
        ms: Math.round(performance.now() - t0),
        attempts,
      };
      if (process.env.NODE_ENV !== "production") console.info("[pose] landmarker ready", info[mode]);
      return lm;
    } catch (e) {
      attempts.push(`${plan.wasm}/${plan.modelSource}/${plan.delegate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new PoseModelError("Pose model failed to load", attempts);
}

function get(mode: Mode, model: ModelVariant): Promise<PoseLandmarker> {
  if (!cache[mode]) {
    cache[mode] = create(mode, model).catch((e) => {
      delete cache[mode]; // allow a retry later
      throw e;
    });
  }
  return cache[mode]!;
}

/** Heavy model, IMAGE mode (single frames, after-image). */
export const getImageLandmarker = () => get("IMAGE", "heavy");
/** Lite model, VIDEO mode (refinement / pose-only scan). Timestamps must increase; see detect.ts. */
export const getVideoLandmarker = () => get("VIDEO", "lite");

/** Warm up (fire-and-forget safe). */
export function preloadPose(which: { image?: boolean; video?: boolean } = { image: true, video: true }): Promise<void> {
  const ps: Promise<unknown>[] = [];
  if (which.image !== false) ps.push(getImageLandmarker());
  if (which.video) ps.push(getVideoLandmarker());
  return Promise.all(ps).then(
    () => undefined,
    () => undefined,
  );
}

export const landmarkerInfo = (mode: Mode = "IMAGE"): LandmarkerInfo | undefined => info[mode];

/** Close and forget the singletons (tests / start over). */
export async function disposeLandmarkers(): Promise<void> {
  for (const m of ["IMAGE", "VIDEO"] as const) {
    const p = cache[m];
    delete cache[m];
    delete info[m];
    if (p) {
      try {
        (await p).close();
      } catch {
        /* ignore */
      }
    }
  }
}
