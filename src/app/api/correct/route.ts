import { isMock, serverConfig } from "@/lib/config";
import { CorrectRequestSchema } from "@/lib/schemas";
import { loadAfterImageDataUrl, mockDelay } from "@/lib/demo/serverFixtures";
import { editImage } from "@/lib/providers/openaiImage";
import { TimeoutError, isOpenAITimeout, openaiErrorStatus, safeErrorMessage } from "@/lib/providers/http";
import { classifyTraceError, recordSponsorTrace } from "@/lib/observability/weave";
import { json, jsonError, readBody } from "../_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req, CorrectRequestSchema);
  if (!body.ok) return body.response;

  if (isMock()) {
    const t0 = Date.now();
    await mockDelay(3000, req.signal);
    // The cached after-photo is a pull-up: only use it for pull-ups, otherwise echo the user's own frame.
    const imageDataUrl = body.data.exercise === "pull_up" ? loadAfterImageDataUrl("pullup") : body.data.beforeDataUrl;
    return json({ imageDataUrl, model: "demo", ms: Date.now() - t0 });
  }

  if (!serverConfig().OPENAI_API_KEY) return jsonError(503, "not_configured", "Image model is not configured");

  const started = Date.now();
  try {
    const result = await editImage(body.data, req.signal);
    await recordSponsorTrace({
      operation: "correct",
      provider: "openai",
      model: result.model,
      mode: "live",
      durationMs: Date.now() - started,
      outcome: "success",
    });
    return json(result);
  } catch (e) {
    await recordSponsorTrace({
      operation: "correct",
      provider: "openai",
      model: serverConfig().OPENAI_IMAGE_MODEL,
      mode: "live",
      durationMs: Date.now() - started,
      outcome: "error",
      errorCategory: classifyTraceError(e),
    });
    if (e instanceof TimeoutError || isOpenAITimeout(e)) return jsonError(504, "timeout", "Image edit timed out");
    const status = openaiErrorStatus(e);
    const code = status === 400 ? "correct_rejected" : status === 429 ? "rate_limited" : "correct_failed";
    return jsonError(502, code, safeErrorMessage(e));
  }
}
