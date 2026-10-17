// GPT vision fallback: one contact sheet (or ≤16 frames) → ScanModelOutput via strict structured output (spec §7.2, §8.3).
import "server-only";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { serverConfig } from "@/lib/config";
import type { ExerciseChoice, View } from "@/lib/types";
import { PICK_FRAMES_SYSTEM_PROMPT, PICK_SYSTEM_PROMPT, SCAN_JSON_SCHEMA, buildPickPrompt } from "@/lib/prompts/pick";
import { getOpenAI } from "./openaiClient";
import { parseScanOutput } from "./parseJson";
import { dropNulls, subsample, toProviderScan, type ProviderScan } from "./scanCommon";

export const GPT_PICK_TIMEOUT_MS = 30_000;

export interface GptPickInput {
  exercise: ExerciseChoice;
  view?: View;
  duration: number;
  contactSheetDataUrl?: string;
  timestamps?: number[];
  /** Used when no contact sheet is available. */
  frames?: { t: number; dataUrl: string }[];
}

export async function pickWithGpt(input: GptPickInput, signal?: AbortSignal): Promise<ProviderScan> {
  const cfg = serverConfig();
  const model = cfg.OPENAI_PICK_MODEL;
  const sheet = input.contactSheetDataUrl;
  let timestamps: number[];
  let images: ResponseInputContent[];
  let system: string;
  if (sheet) {
    timestamps = input.timestamps?.length ? input.timestamps : (input.frames ?? []).map((f) => f.t);
    images = [{ type: "input_image", image_url: sheet, detail: "high" }];
    system = PICK_SYSTEM_PROMPT;
  } else {
    const frames = subsample(input.frames ?? [], 16);
    if (!frames.length) throw new Error("GPT fallback needs a contact sheet or frames");
    timestamps = frames.map((f) => f.t);
    images = frames.map((f) => ({ type: "input_image", image_url: f.dataUrl, detail: "low" }) as ResponseInputContent);
    system = PICK_FRAMES_SYSTEM_PROMPT;
  }

  const res = await getOpenAI().responses.create(
    {
      model,
      instructions: system,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPickPrompt({ exercise: input.exercise, view: input.view, duration: input.duration, timestamps }),
            },
            ...images,
          ],
        },
      ],
      text: {
        format: { type: "json_schema", name: "scan_output", strict: true, schema: SCAN_JSON_SCHEMA as unknown as Record<string, unknown> },
      },
      reasoning: { effort: "low" },
      max_output_tokens: 1500,
    },
    { signal, timeout: GPT_PICK_TIMEOUT_MS, maxRetries: 1 },
  );
  const raw = res.output_text ?? "";
  let text = raw;
  try {
    text = JSON.stringify(dropNulls(JSON.parse(raw)));
  } catch {
    /* leave to the tolerant parser */
  }
  const parsed = parseScanOutput(text, { duration: input.duration, frameTimes: timestamps.length ? timestamps : undefined });
  return toProviderScan(parsed, input, "gpt-fallback", model, raw, sheet ? "contact sheet" : `${images.length} frames`);
}
