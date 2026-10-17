// Hosted NVIDIA Nemotron-3-Nano-Omni scan fallback (spec §1.3 point 3, §7.2).
import "server-only";
import { serverConfig } from "@/lib/config";
import { SCAN_SYSTEM_PROMPT, buildScanPrompt } from "@/lib/prompts/scan";
import { parseScanOutput } from "./parseJson";
import { authHeaders, fetchWithTimeout, withRetry } from "./http";
import { chatText, dataUrlBytes, subsample, toProviderScan, type ProviderScan, type ScanInput } from "./scanCommon";

// The hosted vLLM deployment rejects prompts with more than 12 images.
export const NEMOTRON_MAX_FRAMES = 12;
export const NEMOTRON_MAX_VIDEO_BYTES = 3 * 1024 * 1024;

export function buildNemotronBody(input: ScanInput, model: string) {
  const useVideo = !!input.videoDataUrl && dataUrlBytes(input.videoDataUrl) <= NEMOTRON_MAX_VIDEO_BYTES;
  const frames = useVideo ? [] : subsample(input.frames, NEMOTRON_MAX_FRAMES);
  const text = buildScanPrompt({
    exercise: input.exercise,
    view: input.view,
    duration: input.duration,
    effectiveFps: useVideo ? input.effectiveFps : frames.length / Math.max(input.duration, 0.001),
    frameTimes: useVideo ? undefined : frames.map((f) => f.t),
  });
  const media = useVideo
    ? [{ type: "video_url", video_url: { url: input.videoDataUrl } }]
    : frames.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }));
  return {
    body: {
      model,
      messages: [
        { role: "system", content: SCAN_SYSTEM_PROMPT },
        { role: "user", content: [...media, { type: "text", text }] },
      ],
      max_tokens: 1500,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    },
    frameTimes: (useVideo ? input.frames : frames).map((f) => f.t),
    mode: useVideo ? "video_url" : `${frames.length} image_url frames`,
  };
}

export async function scanWithNemotron(input: ScanInput, signal?: AbortSignal): Promise<ProviderScan> {
  const cfg = serverConfig();
  if (!cfg.NVIDIA_API_KEY) throw new Error("Nemotron is not configured");
  const model = cfg.NEMOTRON_MODEL;
  const { body, frameTimes, mode } = buildNemotronBody(input, model);
  // The free hosted endpoint often answers 503 "ResourceExhausted" for a few seconds under load,
  // so retry 503/429 (only) twice with backoff before falling through the chain.
  const res = await withRetry(
    () =>
      fetchWithTimeout(
        `${cfg.NVIDIA_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: authHeaders(cfg.NVIDIA_API_KEY, { "NVCF-POLL-SECONDS": "1800" }),
          body: JSON.stringify(body),
          signal,
        },
        cfg.NEMOTRON_TIMEOUT_MS,
      ),
    { retries: 2, backoffMs: 1500, retryOn: [429, 503], signal },
  );
  const text = chatText(await res.json());
  const parsed = parseScanOutput(text, { duration: input.duration, frameTimes });
  return toProviderScan(parsed, input, "nemotron", model, text, `mode ${mode}`);
}
