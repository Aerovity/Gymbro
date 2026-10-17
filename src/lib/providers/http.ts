// Small fetch helpers for server-side provider calls (spec §7.2).
import "server-only";

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export class TimeoutError extends Error {
  readonly ms: number;
  constructor(ms: number, message?: string) {
    super(message ?? `Timed out after ${ms} ms`);
    this.name = "TimeoutError";
    this.ms = ms;
  }
}

function anySignal(signals: (AbortSignal | null | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const ctrl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * fetch with a hard timeout (combined with the caller's signal).
 * Throws `TimeoutError` on timeout and `HttpError` on non-2xx responses.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  const signal = anySignal([timeout, init.signal]);
  let res: Response;
  try {
    res = await globalThis.fetch(url, { ...init, signal });
  } catch (e) {
    if (timeout.aborted && !init.signal?.aborted) throw new TimeoutError(ms);
    throw e;
  }
  if (!res.ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 1000);
    } catch {
      /* ignore */
    }
    throw new HttpError(res.status, body);
  }
  return res;
}

export type RetryOn = number | "timeout";

export interface RetryOptions {
  retries?: number;
  backoffMs?: number;
  retryOn?: RetryOn[];
  signal?: AbortSignal;
}

export const DEFAULT_RETRY_ON: RetryOn[] = [429, 500, 502, 503, 504, "timeout"];

export function isRetryable(e: unknown, retryOn: RetryOn[] = DEFAULT_RETRY_ON): boolean {
  if (e instanceof TimeoutError) return retryOn.includes("timeout");
  if (e instanceof HttpError) return retryOn.includes(e.status);
  return false;
}

/** Retry `fn` on retryable failures (never 400/401). */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 1, backoffMs = 800, retryOn = DEFAULT_RETRY_ON, signal } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= retries || !isRetryable(e, retryOn) || signal?.aborted) throw e;
      attempt++;
      if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
}

/** Remove anything that looks like a secret from an error message. */
export function redact(text: string): string {
  let out = text;
  const secrets = [
    process.env.OPENAI_API_KEY,
    process.env.NVIDIA_API_KEY,
    process.env.COSMOS_API_KEY,
    process.env.WANDB_API_KEY,
  ].filter((s): s is string => !!s && s.trim().length >= 6);
  const sponsorSecrets = [
    process.env.VAST_APP_ACCESS_KEY,
    process.env.VAST_BEARER_TOKEN,
    process.env.VAST_USERNAME,
    process.env.VAST_PASSWORD,
  ].filter((s): s is string => !!s && s.trim().length > 0);
  for (const s of [...secrets, ...sponsorSecrets]) out = out.split(s.trim()).join("[redacted]");
  return out
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(sk|nvapi|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

/** A short, key-free, human-readable error message. */
export function safeErrorMessage(e: unknown, max = 300): string {
  let msg: string;
  if (e instanceof Error) msg = e.message || e.name;
  else if (typeof e === "string") msg = e;
  else {
    try {
      msg = JSON.stringify(e);
    } catch {
      msg = String(e);
    }
  }
  msg = redact(msg).replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/gi, "data:…");
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
}

export function authHeaders(key?: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}

/** Duck-typed view of OpenAI SDK errors (APIError has numeric `status`). */
export function openaiErrorStatus(e: unknown): number | undefined {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

export function isOpenAITimeout(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name ?? "";
  const ctor = (e as { constructor?: { name?: string } }).constructor?.name ?? "";
  const msg = (e as { message?: string }).message ?? "";
  return (
    name === "TimeoutError" ||
    ctor === "APIConnectionTimeoutError" ||
    name === "APIConnectionTimeoutError" ||
    /timed?\s*out/i.test(msg)
  );
}
