// Shared helpers for route integration tests (not a test file itself).
import { vi } from "vitest";
import type { CoachReport, CoachRequest, ScanRequest } from "@/lib/schemas";

const KEYS = [
  "DEMO_MODE",
  "MOCK_AI",
  "MOCK_DELAY_MS",
  "COSMOS_BASE_URL",
  "COSMOS_API_KEY",
  "COSMOS_MODEL",
  "COSMOS_INPUT_MODE",
  "COSMOS_FPS",
  "COSMOS_TIMEOUT_MS",
  "COSMOS_REASONING",
  "NVIDIA_API_KEY",
  "NVIDIA_BASE_URL",
  "NEMOTRON_MODEL",
  "NEMOTRON_TIMEOUT_MS",
  "OPENAI_API_KEY",
  "OPENAI_COACH_MODEL",
  "OPENAI_PICK_MODEL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_QUALITY",
  "OPENAI_IMAGE_INPUT_FIDELITY",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "OPENAI_TIMEOUT_MS",
  "WANDB_API_KEY",
  "WEAVE_ENABLED",
  "WEAVE_PROJECT",
  "WEAVE_TRACE_BASE_URL",
  "WEAVE_TIMEOUT_MS",
  "VAST_ENABLED",
  "VAST_BASE_URL",
  "VAST_WORKOUT_TAG",
  "VAST_APP_ACCESS_KEY",
  "VAST_BEARER_TOKEN",
  "VAST_USERNAME",
  "VAST_PASSWORD",
  "VAST_ALLOW_HTTP",
];

export const SECRETS = {
  cosmos: "cosmos-secret-token-123456",
  nvidia: "nvapi-secret-key-abcdef123456",
  openai: "sk-test-secret-key-abcdef123456",
};

/** Reset provider env to a clean, fully configured, non-mock state. */
export function setEnv(overrides: Record<string, string | undefined> = {}) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, {
    MOCK_DELAY_MS: "0",
    COSMOS_BASE_URL: "http://cosmos.test",
    COSMOS_API_KEY: SECRETS.cosmos,
    COSMOS_MODEL: "nvidia/cosmos3-nano-reasoner",
    NVIDIA_API_KEY: SECRETS.nvidia,
    NVIDIA_BASE_URL: "http://nvidia.test/v1",
    OPENAI_API_KEY: SECRETS.openai,
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgH";

export function scanBody(overrides: Partial<ScanRequest> = {}, nFrames = 40): ScanRequest {
  const frames = Array.from({ length: nFrames }, (_, i) => ({ t: Math.round(i * 0.375 * 1000) / 1000, dataUrl: JPEG }));
  return { exercise: "pull_up", view: "front", duration: 15, effectiveFps: 2.67, frames, ...overrides };
}

export const MODEL_SCAN_JSON = JSON.stringify({
  exercise: "pull_up",
  view: "front",
  rep_count: 6,
  events: [
    {
      t_start: 6.8,
      t_peak: 7.1,
      t_end: 7.6,
      rep_index: 3,
      issue: "partial_range_top",
      body_part: "elbows",
      severity: 4,
      confidence: 0.8,
      description: "Chin below the bar.",
    },
  ],
  overall: "Partial reps.",
});

export const chatOk = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export const httpErr = (status: number, body = "error") => new Response(body, { status });

export type FetchCall = { url: string; init: RequestInit; body: Record<string, unknown> | undefined };

/** Stub global fetch with a router; returns the recorded calls. */
export function stubFetch(handler: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: Record<string, unknown> | undefined;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    calls.push({ url, init, body });
    return handler(url, init, calls.length);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export function headerOf(init: RequestInit, name: string): string | undefined {
  const h = init.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : undefined;
}

export const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const COACH_REPORT: CoachReport = {
  spoken_summary: 'Nice pull, but stop short no more. Elbows at 88° — get them to 60° and "own" the top.',
  headline: "CHIN UNDER THE BAR",
  primary_fault: { id: "pullup_top_elbow", title: "Partial top", explanation: "Elbows stay open.", body_part: "elbows", severity: 4 },
  secondary_faults: [{ title: "Knee kick", explanation: "Legs bend." }],
  angle_feedback: [
    {
      angle_key: "elbow_top",
      actual_deg: 88,
      target_min_deg: 45,
      target_max_deg: 75,
      target_ideal_deg: 60,
      verdict: "bad",
      comment: "Bend more.",
    },
  ],
  cues: ["Elbows to ribs."],
  drill: { name: "Negatives", prescription: "3x4", why: "Top strength." },
  corrected_pose: { description: "Chin over bar.", joint_targets: [{ angle_key: "elbow_top", target_deg: 60 }] },
  safety_note: null,
  form_score_adjustment: -3,
};

export function coachBody(): CoachRequest {
  return {
    exercise: "pull_up",
    view: "front",
    side: "both",
    t: 7.25,
    repIndex: 3,
    provider: "cosmos",
    cosmosEvent: {
      t_start: 6.8,
      t_peak: 7.25,
      t_end: 7.6,
      issue: "partial_range_top",
      body_part: "elbows",
      severity: 4,
      confidence: 0.8,
      description: "Chin below the bar.",
    },
    angles: [
      {
        key: "elbow_top",
        label: "Elbow at top",
        value: 88.4,
        unit: "°",
        points: [11, 13, 15],
        reliable: true,
        target: { max: 75, ideal: 60 },
        status: "bad",
        deviation: 13.4,
        ruleId: "pullup_top_elbow",
      },
    ],
    violations: [],
    keypoints: [{ i: 0, name: "nose", x: 360, y: 200, v: 0.99 }],
    frameDataUrl: JPEG,
    W: 720,
    H: 1280,
  };
}

/** Read a whole SSE response into a list of events. */
export async function readEvents(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text();
  return text
    .split(/\n\n/)
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      return { event, data: JSON.parse(data) as unknown };
    });
}

/** Build an async iterable of Responses API stream events. */
export function fakeStream(events: unknown[], throwAt?: { index: number; error: Error }) {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < events.length; i++) {
        if (throwAt && throwAt.index === i) throw throwAt.error;
        yield events[i];
      }
      if (throwAt && throwAt.index >= events.length) throw throwAt.error;
    },
  };
}

export const deltaEvents = (text: string, size = 25) => {
  const out: unknown[] = [{ type: "response.created", sequence_number: 0 }];
  for (let i = 0; i < text.length; i += size) {
    out.push({ type: "response.output_text.delta", delta: text.slice(i, i + size), sequence_number: out.length });
  }
  out.push({ type: "response.completed", sequence_number: out.length });
  return out;
};
