import { isMock, serverConfig } from "@/lib/config";
import { CoachRequestSchema, type CoachRequest } from "@/lib/schemas";
import { mockCoachFor, mockDelay, mockDelayMs } from "@/lib/demo/serverFixtures";
import { runCoach } from "@/lib/providers/openaiCoach";
import { safeErrorMessage } from "@/lib/providers/http";
import { classifyTraceError, recordSponsorTrace } from "@/lib/observability/weave";
import { SSE_HEADERS, jsonError, readBody, sseEvent } from "../_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MOCK_CHUNK = 30;
const MOCK_TOTAL_MS = 4000;

function mockStream(req: CoachRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  const report = mockCoachFor(req);
  const text = JSON.stringify(report);
  const ticks = Math.max(1, Math.ceil(text.length / MOCK_CHUNK));
  const tickMs = MOCK_TOTAL_MS / ticks;
  return new ReadableStream({
    async start(controller) {
      try {
        await mockDelay(400, signal);
        for (let i = 0; i < text.length; i += MOCK_CHUNK) {
          if (signal.aborted) break;
          controller.enqueue(sseEvent("delta", { text: text.slice(i, i + MOCK_CHUNK) }));
          if (mockDelayMs(tickMs) > 0) await mockDelay(tickMs, signal);
        }
        if (!signal.aborted) controller.enqueue(sseEvent("done", report));
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req, CoachRequestSchema);
  if (!body.ok) return body.response;

  if (isMock()) return new Response(mockStream(body.data, req.signal), { headers: SSE_HEADERS });

  if (!serverConfig().OPENAI_API_KEY) return jsonError(503, "not_configured", "Coach model is not configured");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      try {
        const report = await runCoach(body.data, {
          signal: req.signal,
          onDelta: (text) => controller.enqueue(sseEvent("delta", { text })),
        });
        controller.enqueue(sseEvent("done", report));
        await recordSponsorTrace({
          operation: "coach",
          provider: "openai",
          model: serverConfig().OPENAI_COACH_MODEL,
          mode: "live",
          durationMs: Date.now() - started,
          outcome: "success",
        });
      } catch (e) {
        const durationMs = Date.now() - started;
        try {
          controller.enqueue(sseEvent("error", { message: safeErrorMessage(e) }));
        } catch {
          /* client went away */
        }
        await recordSponsorTrace({
          operation: "coach",
          provider: "openai",
          model: serverConfig().OPENAI_COACH_MODEL,
          mode: "live",
          durationMs,
          outcome: "error",
          errorCategory: classifyTraceError(e),
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
