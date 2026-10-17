import { isMock } from "@/lib/config";
import { ScanRequestSchema } from "@/lib/schemas";
import { mockDelay, mockScanFor } from "@/lib/demo/serverFixtures";
import { ScanChainError, runScanChain } from "@/lib/providers/scanChain";
import { safeErrorMessage } from "@/lib/providers/http";
import { json, jsonError, readBody } from "../_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCAN_DEADLINE_MS = 57_000;

export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req, ScanRequestSchema);
  if (!body.ok) return body.response;

  if (isMock()) {
    const t0 = Date.now();
    await mockDelay(2500, req.signal);
    const fx = mockScanFor(body.data);
    return json({
      ...fx,
      trace: [{ step: "scan", provider: "demo", model: fx.model, ok: true, ms: Date.now() - t0, detail: "mock fixture" }],
    });
  }

  try {
    // Stop before the platform kills the function so the client still gets a JSON trace.
    const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(SCAN_DEADLINE_MS)]);
    const result = await runScanChain(body.data, deadline);
    return json(result);
  } catch (e) {
    if (e instanceof ScanChainError) return jsonError(502, "scan_failed", e.message, e.trace);
    return jsonError(502, "scan_failed", safeErrorMessage(e), []);
  }
}
