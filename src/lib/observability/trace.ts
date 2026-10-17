/** Strict metadata boundary shared by the server exporter and the local policy evaluation. */
export type TraceOperation = "scan" | "coach" | "correct" | "health" | "evaluation";
export type TraceProvider = "cosmos" | "nemotron" | "openai" | "wandb" | "local" | "mock";
export type TraceErrorCategory = "timeout" | "auth" | "rate_limit" | "invalid_response" | "network" | "unknown";
export type SponsorTrace = {
  operation: TraceOperation;
  provider: TraceProvider;
  model?: string;
  mode: "live" | "mock" | "synthetic";
  durationMs: number;
  outcome: "success" | "fallback" | "error";
  errorCategory?: TraceErrorCategory;
  evaluation?: { passed: number; total: number };
};

const operations = ["scan", "coach", "correct", "health", "evaluation"];
const providers = ["cosmos", "nemotron", "openai", "wandb", "local", "mock"];
const categories = ["timeout", "auth", "rate_limit", "invalid_response", "network", "unknown"];

/** Copies only approved fields; never serialises caller objects or error messages. */
export function sanitiseTrace(event: SponsorTrace): SponsorTrace | null {
  if (!event || !operations.includes(event.operation) || !providers.includes(event.provider)
    || !["live", "mock", "synthetic"].includes(event.mode)
    || !["success", "fallback", "error"].includes(event.outcome)
    || !Number.isFinite(event.durationMs) || event.durationMs < 0 || event.durationMs > 86_400_000) return null;
  const model = typeof event.model === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(event.model)
    && !event.model.includes("://") && !/^(sk-|nvapi-|wandb_|Bearer)/i.test(event.model)
    ? event.model : undefined;
  const evaluation = event.operation === "evaluation" && event.mode === "synthetic"
    && event.evaluation && Number.isInteger(event.evaluation.passed) && Number.isInteger(event.evaluation.total)
    && event.evaluation.passed >= 0 && event.evaluation.passed <= event.evaluation.total
    && event.evaluation.total > 0 && event.evaluation.total <= 1000
    ? { passed: event.evaluation.passed, total: event.evaluation.total } : undefined;
  return {
    operation: event.operation, provider: event.provider, ...(model ? { model } : {}),
    mode: event.mode, durationMs: Math.round(event.durationMs), outcome: event.outcome,
    ...(event.errorCategory && categories.includes(event.errorCategory) ? { errorCategory: event.errorCategory } : {}),
    ...(evaluation ? { evaluation } : {}),
  };
}

/** Deliberately ignores exception text, which may contain prompts, URLs or credentials. */
export function classifyTraceError(error: unknown): TraceErrorCategory {
  if (!error || typeof error !== "object") return "unknown";
  try {
    const { name, status, constructor } = error as { name?: unknown; status?: unknown; constructor?: { name?: unknown } };
    const constructorName = constructor?.name;
    if (name === "AbortError" || name === "TimeoutError" || name === "APIConnectionTimeoutError" || constructorName === "APIConnectionTimeoutError") return "timeout";
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (name === "SyntaxError" || name === "ZodError" || name === "CoachParseError") return "invalid_response";
    if (name === "TypeError" || name === "FetchError" || name === "APIConnectionError" || constructorName === "APIConnectionError") return "network";
  } catch { /* An unusual error object must not break the provider path. */ }
  return "unknown";
}

export type WeaveConfig = {
  enabled: boolean;
  project?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
};

/** Configuration is server supplied; no request value can choose a trace destination. */
export function readWeaveConfig(env: Record<string, string | undefined>): WeaveConfig {
  const timeout = Number(env.WEAVE_TIMEOUT_MS);
  const config: WeaveConfig = {
    enabled: env.WEAVE_ENABLED === "1",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.max(100, Math.min(2000, Math.round(timeout))) : 750,
  };
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(env.WEAVE_PROJECT ?? "")) {
    config.project = env.WEAVE_PROJECT;
  }
  const apiKey = env.WANDB_API_KEY?.trim();
  if (apiKey && !/[\s\r\n]/.test(apiKey)) config.apiKey = apiKey;
  try {
    const url = new URL(env.WEAVE_TRACE_BASE_URL || "https://trace.wandb.ai");
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) {
      config.baseUrl = url.toString().replace(/\/+$/, "");
    }
  } catch { /* Invalid configuration disables export without exposing its value. */ }
  return config;
}

export function isWeaveConfigured(config: WeaveConfig): boolean {
  return Boolean(config.project && config.apiKey && config.baseUrl);
}
