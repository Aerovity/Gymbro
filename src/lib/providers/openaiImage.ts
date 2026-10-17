// Identity-preserving image edit via OpenAI images.edit (spec §8.4, §12).
import "server-only";
import { toFile } from "openai";
import type { ImageEditParamsNonStreaming } from "openai/resources/images";
import { serverConfig } from "@/lib/config";
import type { CorrectRequest, CorrectResponse } from "@/lib/schemas";
import { buildEditPrompt } from "@/lib/prompts/imageEdit";
import { getOpenAI } from "./openaiClient";
import { TimeoutError, isOpenAITimeout, openaiErrorStatus } from "./http";

export const EDIT_TIMEOUT_MS = { 1: 60_000, 2: 45_000 } as const;
/** Total budget for all tries inside one request (route maxDuration is 90 s). */
export const EDIT_BUDGET_MS = 85_000;
const MIN_RETRY_MS = 15_000;

type Quality = NonNullable<ImageEditParamsNonStreaming["quality"]>;
const QUALITIES: Quality[] = ["low", "medium", "high", "xhigh", "max", "auto"];
type Fidelity = NonNullable<ImageEditParamsNonStreaming["input_fidelity"]>;

export function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid image data URL");
  const mime = m[1];
  const buffer = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { buffer, mime };
}

const extFor = (mime: string) => (mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg");

export async function editImage(req: CorrectRequest, signal?: AbortSignal): Promise<CorrectResponse> {
  const cfg = serverConfig();
  const t0 = Date.now();
  const attempt = req.attempt ?? 1;
  const timeout = EDIT_TIMEOUT_MS[attempt];
  const prompt = buildEditPrompt({
    exercise: req.exercise,
    correctedPose: req.correctedPose,
    primaryFault: req.primaryFault,
    attempt,
    measuredMiss: req.measuredMiss,
  });
  const { buffer, mime } = decodeDataUrl(req.beforeDataUrl);
  const quality = (QUALITIES as string[]).includes(cfg.OPENAI_IMAGE_QUALITY)
    ? (cfg.OPENAI_IMAGE_QUALITY as Quality)
    : "medium";
  const fidelity = ["high", "low"].includes(cfg.OPENAI_IMAGE_INPUT_FIDELITY)
    ? (cfg.OPENAI_IMAGE_INPUT_FIDELITY as Fidelity)
    : undefined;

  const call = async (withFidelity: boolean) => {
    const image = await toFile(buffer, `before.${extFor(mime)}`, { type: mime });
    const params: ImageEditParamsNonStreaming = {
      model: cfg.OPENAI_IMAGE_MODEL,
      image: [image],
      prompt,
      size: req.size,
      quality,
      output_format: "jpeg",
      output_compression: 85,
      n: 1,
      ...(withFidelity && fidelity ? { input_fidelity: fidelity } : {}),
    };
    const left = EDIT_BUDGET_MS - (Date.now() - t0);
    return getOpenAI().images.edit(params, { signal, timeout: Math.min(timeout, left), maxRetries: 0 });
  };

  let useFidelity = !!fidelity;
  let retried5xx = false;
  let res;
  for (;;) {
    try {
      res = await call(useFidelity);
      break;
    } catch (e) {
      const status = openaiErrorStatus(e);
      const msg = e instanceof Error ? e.message : String(e);
      if (useFidelity && status === 400 && /input_fidelity/i.test(msg)) {
        useFidelity = false;
        continue;
      }
      const timedOut = isOpenAITimeout(e);
      const budgetLeft = EDIT_BUDGET_MS - (Date.now() - t0) >= MIN_RETRY_MS;
      if (!retried5xx && budgetLeft && !signal?.aborted && (timedOut || (status !== undefined && status >= 500))) {
        retried5xx = true;
        continue;
      }
      if (timedOut) throw new TimeoutError(timeout, "Image edit timed out");
      throw e;
    }
  }

  const img = res.data?.[0];
  let b64 = img?.b64_json;
  if (!b64 && img?.url) {
    const r = await fetch(img.url, { signal });
    if (!r.ok) throw new Error(`Could not download edited image (${r.status})`);
    b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  }
  if (!b64) throw new Error("Image edit returned no image");
  const fmt = res.output_format ?? "jpeg";
  return {
    imageDataUrl: `data:image/${fmt};base64,${b64}`,
    model: cfg.OPENAI_IMAGE_MODEL,
    ms: Date.now() - t0,
    ...(img?.revised_prompt ? { revisedPrompt: img.revised_prompt } : {}),
    prompt,
  };
}
