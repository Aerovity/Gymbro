// Browser API client for the Gym Bro route handlers. Browser-safe: no server imports.
import {
  CoachReportSchema,
  type CoachReport,
  type CoachRequest,
  type CorrectRequest,
  type CorrectResponse,
  type HealthResponse,
  type PickFrameRequest,
  type ScanRequest,
} from "@/lib/schemas";
import type { ScanResult, TraceEntry } from "@/lib/types";
import { extractPartialString } from "./partialJson";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly trace?: TraceEntry[];
  constructor(message: string, status: number, code: string, trace?: TraceEntry[]) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.trace = trace;
  }
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiClientError(e instanceof Error ? e.message : "Network error", 0, "network");
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function toApiError(res: Response): Promise<ApiClientError> {
  let code = res.status === 413 ? "payload_too_large" : "http_error";
  let message = `Request failed (${res.status})`;
  let trace: TraceEntry[] | undefined;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { code?: string; message?: string }; trace?: TraceEntry[] };
      if (j.error?.code) code = j.error.code;
      if (j.error?.message) message = j.error.message;
      if (Array.isArray(j.trace)) trace = j.trace;
    } catch {
      if (text) message = text.slice(0, 200);
    }
  } catch {
    /* ignore */
  }
  return new ApiClientError(message, res.status, code, trace);
}

const postJson = (url: string, body: unknown, signal?: AbortSignal) =>
  send(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

export async function getHealth(opts: { probe?: boolean; signal?: AbortSignal } = {}): Promise<HealthResponse> {
  const res = await send(`/api/health${opts.probe ? "?probe=1" : ""}`, { method: "GET", signal: opts.signal });
  return (await res.json()) as HealthResponse;
}

export async function postScan(req: ScanRequest, signal?: AbortSignal): Promise<ScanResult> {
  return (await (await postJson("/api/scan", req, signal)).json()) as ScanResult;
}

export async function postPickFrame(req: PickFrameRequest, signal?: AbortSignal): Promise<ScanResult> {
  return (await (await postJson("/api/pick-frame", req, signal)).json()) as ScanResult;
}

export async function postCorrect(req: CorrectRequest, signal?: AbortSignal): Promise<CorrectResponse> {
  return (await (await postJson("/api/correct", req, signal)).json()) as CorrectResponse;
}

/** Server TTS (audio/mpeg). Throws ApiClientError (501 `tts_not_configured`) when unavailable → use browser speech. */
export async function fetchTts(text: string, signal?: AbortSignal): Promise<Blob> {
  return (await postJson("/api/tts", { text }, signal)).blob();
}

// ───────────── SSE ─────────────

export interface SseMessage {
  event: string;
  data: string;
}

/** Incremental SSE parser: push decoded text chunks (any boundaries); `onEvent` fires per complete event. */
export function createSseParser(onEvent: (msg: SseMessage) => void) {
  let buf = "";
  let event = "";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length || event) onEvent({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return; // comment / keep-alive
    const c = l.indexOf(":");
    const field = c === -1 ? l : l.slice(0, c);
    let value = c === -1 ? "" : l.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  return {
    push(chunk: string) {
      buf += chunk;
      let idx: number;
      while ((idx = buf.search(/\r\n|\r|\n/)) !== -1) {
        // A lone trailing "\r" may be the first half of "\r\n": wait for more input.
        if (buf[idx] === "\r" && idx === buf.length - 1) break;
        const l = buf.slice(0, idx);
        buf = buf.slice(idx + (buf.startsWith("\r\n", idx) ? 2 : 1));
        line(l);
      }
    },
    /** Flush at end of stream (dispatches a final event lacking its blank line). */
    end() {
      if (buf) {
        const rest = buf.replace(/\r$/, "");
        buf = "";
        line(rest);
      }
      dispatch();
    },
  };
}

/** Read an SSE response body with getReader(), calling onEvent per event. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (msg: SseMessage) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) parser.push(decoder.decode(value, { stream: true }));
    }
    finished = true;
    parser.push(decoder.decode());
    parser.end();
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface StreamCoachOptions {
  /** fullTextSoFar = raw JSON text so far; summarySoFar = partial `spoken_summary`. */
  onDelta?: (fullTextSoFar: string, summarySoFar: string) => void;
  signal?: AbortSignal;
}

class StopStream extends Error {}

export async function streamCoach(req: CoachRequest, opts: StreamCoachOptions = {}): Promise<CoachReport> {
  const res = await send("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(req),
    signal: opts.signal,
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    // Unexpected JSON body: maybe an error envelope or a plain report.
    const j = (await res.json()) as unknown;
    const r = CoachReportSchema.safeParse(j);
    if (r.success) return r.data;
    throw new ApiClientError("Unexpected coach response", res.status, "coach_failed");
  }
  if (!res.body) throw new ApiClientError("Empty coach stream", res.status, "coach_failed");

  let full = "";
  let report: CoachReport | undefined;
  let failure: ApiClientError | undefined;
  try {
    await readSse(res.body, (msg) => {
      if (msg.event === "delta") {
        const { text } = JSON.parse(msg.data) as { text?: string };
        if (typeof text === "string" && text) {
          full += text;
          opts.onDelta?.(full, extractPartialString(full, "spoken_summary"));
        }
      } else if (msg.event === "done") {
        const r = CoachReportSchema.safeParse(JSON.parse(msg.data));
        if (!r.success) failure = new ApiClientError("Coach report failed validation", 502, "coach_failed");
        else report = r.data;
        throw new StopStream();
      } else if (msg.event === "error") {
        let message = "Coach failed";
        try {
          message = (JSON.parse(msg.data) as { message?: string }).message || message;
        } catch {
          /* keep default */
        }
        failure = new ApiClientError(message, 502, "coach_failed");
        throw new StopStream();
      }
    });
  } catch (e) {
    if (!(e instanceof StopStream)) {
      if (isAbort(e)) throw e;
      throw new ApiClientError(e instanceof Error ? e.message : "Coach stream broke", 0, "network");
    }
  }
  if (failure) throw failure;
  if (!report) throw new ApiClientError("Coach stream ended without a result", 502, "coach_failed");
  return report;
}
