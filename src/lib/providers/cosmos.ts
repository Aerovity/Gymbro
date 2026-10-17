// NVIDIA Cosmos Reasoner scan (spec §1.3, §7.2). OpenAI-compatible chat completions with video extensions.
import "server-only";
import { serverConfig } from "@/lib/config";
import { SCAN_SYSTEM_PROMPT, buildScanPrompt } from "@/lib/prompts/scan";
import { parseScanOutput } from "./parseJson";
import { HttpError, authHeaders, fetchWithTimeout, withRetry } from "./http";
import { chatText, toProviderScan, type ProviderScan, type ScanInput } from "./scanCommon";

export type CosmosInputMode = "video_frames" | "video_url" | "image_frames";

const modelCache = new Map<string, string>();

export function resetCosmosModelCache() {
  modelCache.clear();
}

export function cachedCosmosModel(base = serverConfig().COSMOS_BASE_URL): string | undefined {
  return modelCache.get(base);
}

/** GET {base}/v1/models and pick the first id containing "cosmos" (else the first id). Cached per base URL. */
export async function discoverModel(base: string, key: string, signal?: AbortSignal, timeoutMs = 8_000): Promise<string> {
  const hit = modelCache.get(base);
  if (hit) return hit;
  const res = await fetchWithTimeout(`${base}/v1/models`, { method: "GET", headers: authHeaders(key), signal }, timeoutMs);
  const json = (await res.json()) as { data?: { id?: string }[] };
  const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  const id = ids.find((i) => i.toLowerCase().includes("cosmos")) ?? ids[0];
  if (!id) throw new Error("Cosmos /v1/models returned no models");
  modelCache.set(base, id);
  return id;
}

type Part = Record<string, unknown>;

export function buildCosmosContent(
  mode: CosmosInputMode,
  input: ScanInput,
  reasoning: boolean,
): { parts: Part[]; mode: CosmosInputMode } {
  let m = mode;
  if (m === "video_url" && !input.videoDataUrl) m = "video_frames";
  const frameTimes = input.frames.map((f) => f.t);
  const text = buildScanPrompt({
    exercise: input.exercise,
    view: input.view,
    duration: input.duration,
    effectiveFps: input.effectiveFps,
    reasoning,
    frameTimes: m === "image_frames" ? frameTimes : undefined,
  });
  let media: Part[];
  if (m === "video_frames") media = [{ type: "video_frames", video_frames: input.frames.map((f) => f.dataUrl) }];
  else if (m === "video_url") media = [{ type: "video_url", video_url: { url: input.videoDataUrl } }];
  else media = input.frames.map((f) => ({ type: "image_url", image_url: { url: f.dataUrl } }));
  return { parts: [...media, { type: "text", text }], mode: m };
}

export async function scanWithCosmos(input: ScanInput, signal?: AbortSignal): Promise<ProviderScan> {
  const cfg = serverConfig();
  if (!cfg.COSMOS_BASE_URL) throw new Error("Cosmos is not configured");
  const base = cfg.COSMOS_BASE_URL;
  const model = cfg.COSMOS_MODEL || (await discoverModel(base, cfg.COSMOS_API_KEY, signal));

  const call = async (mode: CosmosInputMode) => {
    const { parts, mode: used } = buildCosmosContent(mode, input, cfg.COSMOS_REASONING);
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: SCAN_SYSTEM_PROMPT },
        { role: "user", content: parts },
      ],
      max_tokens: cfg.COSMOS_REASONING ? 4096 : 1500,
      temperature: 0.2,
      top_p: 0.3,
    };
    if (used !== "image_frames") body.media_io_kwargs = { video: { fps: input.effectiveFps } };
    const res = await withRetry(
      () =>
        fetchWithTimeout(
          `${base}/v1/chat/completions`,
          { method: "POST", headers: authHeaders(cfg.COSMOS_API_KEY), body: JSON.stringify(body), signal },
          cfg.COSMOS_TIMEOUT_MS,
        ),
      { retries: 1, signal },
    );
    return { json: await res.json(), used };
  };

  let out: { json: unknown; used: CosmosInputMode };
  let detail: string | undefined;
  try {
    out = await call(cfg.COSMOS_INPUT_MODE);
  } catch (e) {
    // Compatibility guard: endpoints that reject `video_frames` get one retry with separate images.
    if (e instanceof HttpError && (e.status === 400 || e.status === 422) && cfg.COSMOS_INPUT_MODE !== "image_frames") {
      detail = `${cfg.COSMOS_INPUT_MODE} rejected (${e.status}); retried as image_frames`;
      out = await call("image_frames");
    } else throw e;
  }
  const text = chatText(out.json);
  const parsed = parseScanOutput(text, { duration: input.duration, frameTimes: input.frames.map((f) => f.t) });
  return toProviderScan(parsed, input, "cosmos", model, text, detail ?? `mode ${out.used}`);
}
