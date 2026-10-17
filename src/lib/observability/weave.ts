import "server-only";
import { exportSponsorTrace, type TraceExportResult } from "./exporter";
import { isWeaveConfigured, readWeaveConfig, type SponsorTrace } from "./trace";

export { classifyTraceError } from "./trace";
export type { SponsorTrace, TraceErrorCategory, TraceOperation, TraceProvider } from "./trace";

/** Configuration presence only: this is not a live connectivity check. */
export function getWeaveStatus(): { enabled: boolean; configured: boolean } {
  const config = readWeaveConfig(process.env);
  return { enabled: config.enabled, configured: isWeaveConfigured(config) };
}

/** Call after the provider operation; tracing failure must not change its result. */
export async function recordSponsorTrace(event: SponsorTrace): Promise<TraceExportResult> {
  try {
    return await exportSponsorTrace(event, readWeaveConfig(process.env));
  } catch {
    return { status: "failed", reason: "network" };
  }
}
