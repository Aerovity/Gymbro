// Shared helpers for the scan providers (Cosmos, Nemotron, GPT fallback).
import "server-only";
import type { ScanModelOutput, ScanRequest } from "@/lib/schemas";
import type { ProviderId, ScanResult } from "@/lib/types";

/** What a single provider returns; the chain adds the trace. */
export type ProviderScan = Omit<ScanResult, "trace"> & { detail?: string };

export type ScanInput = ScanRequest;

export function toProviderScan(
  parsed: ScanModelOutput,
  input: Pick<ScanRequest, "exercise">,
  provider: ProviderId,
  model: string,
  raw: string,
  detail?: string,
): ProviderScan {
  return {
    provider,
    model,
    exercise: input.exercise !== "auto" ? input.exercise : parsed.exercise,
    view: parsed.view,
    repCount: parsed.rep_count,
    events: parsed.events,
    overall: parsed.overall,
    raw,
    ...(detail ? { detail } : {}),
  };
}

/** Extract assistant text from an OpenAI-compatible chat completion JSON. */
export function chatText(json: unknown): string {
  const msg = (json as { choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[] })?.choices?.[0]
    ?.message;
  const c = msg?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

/** Evenly pick at most n items, keeping first and last. */
export function subsample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  if (n <= 1) return [items[0]];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

/** Approximate decoded byte size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.length - i - 1 : dataUrl.length;
  return Math.floor((b64 * 3) / 4);
}

/** Recursively drop null-valued object keys (strict-mode outputs use null for "absent"). */
export function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (val !== null) out[k] = dropNulls(val);
    return out;
  }
  return v;
}
