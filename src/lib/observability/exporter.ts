import { randomUUID } from "node:crypto";
import { isWeaveConfigured, sanitiseTrace, type SponsorTrace, type WeaveConfig } from "./trace";

export type TraceExportResult =
  | { status: "disabled" }
  | { status: "sent" }
  | { status: "failed"; reason: "configuration" | "invalid_metadata" | "timeout" | "network" | "http" };

/**
 * Weave Service API, without SDK automatic capture of prompts/images.
 * https://docs.coreweave.com/products/wandb/weave/reference/service-api
 * https://docs.coreweave.com/products/wandb/weave/cookbooks/weave_via_service_api
 * A single deadline covers both requests. There is no retry or persistent queue.
 */
export async function exportSponsorTrace(
  event: SponsorTrace,
  config: WeaveConfig,
  fetcher: typeof fetch = fetch,
): Promise<TraceExportResult> {
  if (!config.enabled) return { status: "disabled" };
  if (!isWeaveConfigured(config)) return { status: "failed", reason: "configuration" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const metadata = sanitiseTrace(event);
    if (!metadata) return { status: "failed", reason: "invalid_metadata" };
    // A miswired model field must never expose the export credential.
    if (metadata.model?.includes(config.apiKey!)) delete metadata.model;
    const id = randomUUID();
    const endedAt = Date.now();
    const startedAt = endedAt - metadata.durationMs;
    // Match the official start/end cookbook's HTTP Basic ("api", API key) authentication.
    const headers = { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}` };
    const post = async (path: string, body: unknown): Promise<boolean> => {
      if (controller.signal.aborted) return false;
      const response = await fetcher(`${config.baseUrl}${path}`, {
        method: "POST", headers, body: JSON.stringify(body),
        signal: controller.signal, cache: "no-store", redirect: "error",
      });
      // Do not parse, log or retain response bodies, including errors.
      void response.body?.cancel().catch(() => undefined);
      return response.ok;
    };
    const send = async (): Promise<TraceExportResult> => {
      const started = await post("/call/start", { start: {
        project_id: config.project, id, trace_id: id, op_name: `gymbro.${metadata.operation}`,
        started_at: new Date(startedAt).toISOString(), inputs: {},
        attributes: { ...metadata, telemetry_schema: 1, content_capture: false },
      } });
      if (!started) return { status: "failed", reason: "http" };
      const ended = await post("/call/end", { end: {
        project_id: config.project, id, ended_at: new Date(endedAt).toISOString(), output: null,
        summary: { duration_ms: metadata.durationMs, outcome: metadata.outcome, mode: metadata.mode },
        ...(metadata.outcome === "error" ? { exception: metadata.errorCategory ?? "unknown" } : {}),
      } });
      return ended ? { status: "sent" } : { status: "failed", reason: "http" };
    };
    const timeout = new Promise<TraceExportResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: "failed", reason: "timeout" });
      }, Math.max(100, Math.min(2000, config.timeoutMs)));
    });
    return await Promise.race([send(), timeout]);
  } catch {
    return { status: "failed", reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
