// OpenAI coach: streaming Responses API with strict JSON schema (spec §8.2), non-stream fallback.
import "server-only";
import type { ResponseCreateParamsBase } from "openai/resources/responses/responses";
import { serverConfig } from "@/lib/config";
import { CoachReportSchema, type CoachReport, type CoachRequest } from "@/lib/schemas";
import { COACH_JSON_SCHEMA, COACH_SYSTEM_PROMPT, buildCoachUserPrompt } from "@/lib/prompts/coach";
import { getOpenAI } from "./openaiClient";
import { TimeoutError, safeErrorMessage } from "./http";

export const COACH_FIRST_TOKEN_MS = 15_000;
export const COACH_TOTAL_MS = 45_000;

export class CoachParseError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "CoachParseError";
    this.raw = raw;
  }
}

export function buildCoachParams(req: CoachRequest): ResponseCreateParamsBase {
  const cfg = serverConfig();
  return {
    model: cfg.OPENAI_COACH_MODEL,
    instructions: COACH_SYSTEM_PROMPT,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildCoachUserPrompt(req) },
          { type: "input_image", image_url: req.frameDataUrl, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "coach_report",
        strict: true,
        schema: COACH_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    reasoning: { effort: "low" },
    max_output_tokens: 1200,
  };
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

/** Lenient clean-up before strict Zod validation (array caps, integer clamps). */
export function normalizeCoach(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const o = { ...(obj as Record<string, unknown>) };
  if (Array.isArray(o.secondary_faults)) o.secondary_faults = o.secondary_faults.slice(0, 2);
  if (Array.isArray(o.cues)) o.cues = o.cues.filter((c) => typeof c === "string" && c.trim()).slice(0, 4);
  if ("form_score_adjustment" in o) o.form_score_adjustment = clampInt(o.form_score_adjustment, -10, 10, 0);
  if (o.safety_note === undefined || o.safety_note === "") o.safety_note = null;
  if (o.primary_fault && typeof o.primary_fault === "object") {
    const pf = { ...(o.primary_fault as Record<string, unknown>) };
    pf.severity = clampInt(pf.severity, 1, 5, 3);
    o.primary_fault = pf;
  }
  return o;
}

/** Parse the model's full JSON text into a validated CoachReport. Throws CoachParseError. */
export function parseCoachText(text: string): CoachReport {
  let json: unknown;
  try {
    const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    json = JSON.parse(s);
  } catch {
    throw new CoachParseError("Coach returned invalid JSON", text);
  }
  const r = CoachReportSchema.safeParse(normalizeCoach(json));
  if (!r.success) {
    const issues = r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new CoachParseError(`Coach JSON failed validation: ${issues}`, text);
  }
  return r.data;
}

export interface RunCoachOptions {
  signal?: AbortSignal;
  /** Called with each text delta as it streams. */
  onDelta?: (delta: string) => void;
  firstTokenMs?: number;
  totalMs?: number;
}

/** Non-streaming request (fallback). */
export async function coachOnce(req: CoachRequest, signal?: AbortSignal, timeoutMs = COACH_TOTAL_MS): Promise<{ report: CoachReport; text: string }> {
  const res = await getOpenAI().responses.create(
    { ...buildCoachParams(req), stream: false },
    { signal, timeout: timeoutMs, maxRetries: 0 },
  );
  if (res.error) throw new Error(`Coach response error: ${res.error.message}`);
  const text = res.output_text ?? "";
  return { report: parseCoachText(text), text };
}

/**
 * Stream the coach report. If streaming fails before any text arrives, falls back to one
 * non-streaming request (its full text is emitted as a single delta). If text has already been
 * streamed and the final JSON is invalid, throws CoachParseError.
 */
export async function runCoach(req: CoachRequest, opts: RunCoachOptions = {}): Promise<CoachReport> {
  const { signal, onDelta, firstTokenMs = COACH_FIRST_TOKEN_MS, totalMs = COACH_TOTAL_MS } = opts;
  const started = Date.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  let firstTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, firstTokenMs);
  const totalTimer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, totalMs);

  let full = "";
  try {
    try {
      const stream = await getOpenAI().responses.create(
        { ...buildCoachParams(req), stream: true },
        { signal: ctrl.signal, timeout: totalMs, maxRetries: 0 },
      );
      for await (const ev of stream) {
        if (ev.type === "response.output_text.delta") {
          if (firstTimer) {
            clearTimeout(firstTimer);
            firstTimer = undefined;
          }
          full += ev.delta;
          onDelta?.(ev.delta);
        } else if (ev.type === "response.refusal.delta") {
          // ignore; a refusal produces no JSON and fails validation below
        } else if (ev.type === "error") {
          throw new Error(`Coach stream error: ${ev.message}`);
        } else if (ev.type === "response.failed") {
          throw new Error(`Coach response failed: ${ev.response.error?.message ?? "unknown"}`);
        } else if (ev.type === "response.incomplete") {
          throw new Error(`Coach response incomplete: ${ev.response.incomplete_details?.reason ?? "unknown"}`);
        }
      }
      if (timedOut) throw new TimeoutError(totalMs, "Coach stream timed out");
    } catch (e) {
      if (full.length > 0 || signal?.aborted) {
        throw timedOut ? new TimeoutError(totalMs, "Coach stream timed out") : e;
      }
      // Nothing streamed yet: one non-streaming retry with the remaining budget.
      const remaining = Math.max(5_000, totalMs - (Date.now() - started));
      console.warn("[coach] stream failed, falling back to non-stream:", safeErrorMessage(e));
      const { report, text } = await coachOnce(req, signal, remaining);
      onDelta?.(text);
      return report;
    }
    return parseCoachText(full);
  } finally {
    if (firstTimer) clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", onAbort);
  }
}
