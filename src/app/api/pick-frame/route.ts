import { isMock, serverConfig } from "@/lib/config";
import { PickFrameRequestSchema } from "@/lib/schemas";
import type { TraceEntry } from "@/lib/types";
import { mockDelay, mockScanFor } from "@/lib/demo/serverFixtures";
import { pickWithGpt } from "@/lib/providers/gptVisionPick";
import { safeErrorMessage } from "@/lib/providers/http";
import { json, jsonError, readBody } from "../_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req, PickFrameRequestSchema);
  if (!body.ok) return body.response;
  const t0 = Date.now();

  if (isMock()) {
    await mockDelay(2000, req.signal);
    const fx = mockScanFor(body.data);
    return json({
      ...fx,
      trace: [{ step: "scan", provider: "demo", model: fx.model, ok: true, ms: Date.now() - t0, detail: "mock fixture" }],
    });
  }

  const cfg = serverConfig();
  if (!cfg.OPENAI_API_KEY) return jsonError(503, "not_configured", "GPT vision fallback is not configured");

  try {
    const { detail, ...result } = await pickWithGpt(
      {
        exercise: body.data.exercise,
        duration: body.data.duration,
        contactSheetDataUrl: body.data.contactSheetDataUrl,
        timestamps: body.data.timestamps,
      },
      req.signal,
    );
    const trace: TraceEntry[] = [
      { step: "scan", provider: "gpt-fallback", model: result.model, ok: true, ms: Date.now() - t0, detail, fallback: true },
    ];
    return json({ ...result, trace });
  } catch (e) {
    const trace: TraceEntry[] = [
      {
        step: "scan",
        provider: "gpt-fallback",
        model: cfg.OPENAI_PICK_MODEL,
        ok: false,
        ms: Date.now() - t0,
        error: safeErrorMessage(e),
        fallback: true,
      },
    ];
    return jsonError(502, "scan_failed", "GPT vision fallback failed", trace);
  }
}
