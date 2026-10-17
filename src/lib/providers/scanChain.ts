// Scan provider chain: Cosmos → Nemotron → GPT contact sheet (spec §7.2, §12).
import "server-only";
import { serverConfig, type ServerConfig } from "@/lib/config";
import type { ProviderId, ScanResult, TraceEntry } from "@/lib/types";
import { cachedCosmosModel, scanWithCosmos } from "./cosmos";
import { scanWithNemotron } from "./nemotron";
import { pickWithGpt } from "./gptVisionPick";
import { safeErrorMessage } from "./http";
import type { ProviderScan, ScanInput } from "./scanCommon";

export interface ScanProvider {
  id: ProviderId;
  configured: (c: ServerConfig) => boolean;
  model: (c: ServerConfig) => string | undefined;
  run: (input: ScanInput, signal?: AbortSignal) => Promise<ProviderScan>;
}

export const DEFAULT_PROVIDERS: ScanProvider[] = [
  {
    id: "cosmos",
    configured: (c) => !!c.COSMOS_BASE_URL,
    model: (c) => c.COSMOS_MODEL || cachedCosmosModel(c.COSMOS_BASE_URL),
    run: scanWithCosmos,
  },
  {
    id: "nemotron",
    configured: (c) => !!c.NVIDIA_API_KEY,
    model: (c) => c.NEMOTRON_MODEL,
    run: scanWithNemotron,
  },
  {
    id: "gpt-fallback",
    configured: (c) => !!c.OPENAI_API_KEY,
    model: (c) => c.OPENAI_PICK_MODEL,
    run: (input, signal) =>
      pickWithGpt(
        {
          exercise: input.exercise,
          view: input.view,
          duration: input.duration,
          contactSheetDataUrl: input.contactSheetDataUrl,
          timestamps: input.contactSheetTimestamps,
          frames: input.frames,
        },
        signal,
      ),
  },
];

export class ScanChainError extends Error {
  readonly trace: TraceEntry[];
  constructor(message: string, trace: TraceEntry[]) {
    super(message);
    this.name = "ScanChainError";
    this.trace = trace;
  }
}

/**
 * Try providers in order, skipping unconfigured ones. Stops at the first result with ≥1 event;
 * a valid zero-event result is kept and returned only if no later provider finds events.
 * Throws ScanChainError (with the trace) when every configured provider fails.
 */
export async function runScanChain(
  input: ScanInput,
  signal?: AbortSignal,
  providers: ScanProvider[] = DEFAULT_PROVIDERS,
): Promise<ScanResult> {
  const cfg = serverConfig();
  const trace: TraceEntry[] = [];
  let empty: ProviderScan | null = null;

  for (const p of providers) {
    if (!p.configured(cfg)) continue;
    if (signal?.aborted) break;
    const t0 = Date.now();
    try {
      const out = await p.run(input, signal);
      const ms = Date.now() - t0;
      const { detail, ...result } = out;
      const n = result.events.length;
      trace.push({
        step: "scan",
        provider: p.id,
        model: result.model,
        ok: true,
        ms,
        detail: [`${n} event${n === 1 ? "" : "s"}`, detail].filter(Boolean).join(" · "),
        ...(trace.length ? { fallback: true } : {}),
      });
      if (n > 0) return { ...result, trace };
      if (!empty) empty = out;
    } catch (e) {
      trace.push({
        step: "scan",
        provider: p.id,
        model: p.model(cfg),
        ok: false,
        ms: Date.now() - t0,
        error: safeErrorMessage(e),
        ...(trace.length ? { fallback: true } : {}),
      });
    }
  }

  if (empty) {
    const { detail: _detail, ...result } = empty;
    void _detail;
    return { ...result, trace };
  }
  throw new ScanChainError(
    trace.length ? "All scan providers failed" : "No scan providers are configured",
    trace,
  );
}
