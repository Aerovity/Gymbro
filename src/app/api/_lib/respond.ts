// Shared helpers for API route handlers (private folder: not routable).
import "server-only";
import type { z } from "zod";
import { MAX_BODY_BYTES } from "@/lib/schemas";
import type { TraceEntry } from "@/lib/types";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function jsonError(status: number, code: string, message: string, trace?: TraceEntry[]): Response {
  return json({ error: { code, message }, ...(trace ? { trace } : {}) }, status);
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Read the raw body as text, enforce MAX_BODY_BYTES (413), JSON.parse (400) and Zod-validate (400). */
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<BodyResult<z.infer<S>>> {
  const tooLarge = () =>
    jsonError(
      413,
      "payload_too_large",
      `Request body exceeds ${(MAX_BODY_BYTES / (1024 * 1024)).toFixed(1)} MB. Send fewer or smaller frames.`,
    );
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };

  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonError(400, "bad_request", "Could not read request body") };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "Request body is not valid JSON") };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, response: jsonError(400, "invalid_request", `Invalid request: ${issues}`) };
  }
  return { ok: true, data: r.data };
}

const enc = new TextEncoder();
export const sseEvent = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
