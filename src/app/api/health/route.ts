import { isMock, providersConfigured, serverConfig } from "@/lib/config";
import type { HealthResponse } from "@/lib/schemas";
import { authHeaders, fetchWithTimeout, safeErrorMessage } from "@/lib/providers/http";
import { getOpenAI } from "@/lib/providers/openaiClient";
import { json } from "../_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROBE_TIMEOUT_MS = 4000;

type Probe = { ok: boolean; ms: number; detail?: string };

async function timed(fn: () => Promise<string | undefined>): Promise<Probe> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: safeErrorMessage(e, 160) };
  }
}

export async function GET(req: Request): Promise<Response> {
  const cfg = serverConfig();
  const providers = providersConfigured(cfg);
  const out: HealthResponse = { ok: true, demo: cfg.DEMO_MODE, mock: isMock(), providers };

  const probe = new URL(req.url).searchParams.get("probe");
  if (probe === "1" || probe === "true") {
    const tasks: Promise<[string, Probe]>[] = [];
    if (providers.cosmos) {
      tasks.push(
        timed(async () => {
          const res = await fetchWithTimeout(
            `${cfg.COSMOS_BASE_URL}/v1/models`,
            { method: "GET", headers: authHeaders(cfg.COSMOS_API_KEY), signal: req.signal },
            PROBE_TIMEOUT_MS,
          );
          const j = (await res.json()) as { data?: { id?: string }[] };
          const ids = (j.data ?? []).map((m) => m.id).filter(Boolean);
          return ids.length ? `models: ${ids.slice(0, 3).join(", ")}` : "no models listed";
        }).then((p) => ["cosmos", p] as [string, Probe]),
      );
    }
    if (providers.openai) {
      tasks.push(
        timed(async () => {
          const m = await getOpenAI().models.retrieve(cfg.OPENAI_COACH_MODEL, {
            timeout: PROBE_TIMEOUT_MS,
            maxRetries: 0,
            signal: req.signal,
          });
          return `model: ${m.id}`;
        }).then((p) => ["openai", p] as [string, Probe]),
      );
    }
    out.probe = Object.fromEntries(await Promise.all(tasks));
  }
  return json(out);
}
