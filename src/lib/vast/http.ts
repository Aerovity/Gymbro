import "server-only";
import { VastError } from "./config";

/** Enforce the limit while reading, including responses without Content-Length. */
export async function readLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        throw new VastError(502, "vast_response_too_large", "VAST returned more data than this request allows.");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(response: Response, maxBytes = 512 * 1024): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new VastError(502, "vast_response_too_large", "VAST returned more data than this request allows.");
  }
  const text = new TextDecoder().decode(await readLimited(response.body, maxBytes));
  try { return JSON.parse(text); } catch { throw new VastError(502, "vast_invalid_response", "VAST returned an invalid response."); }
}

export function requestSignal(signal?: AbortSignal, timeout = 20_000): AbortSignal {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
}

export async function checkedFetch(url: URL | string, init: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: "error", cache: "no-store" }); }
  catch {
    if (init.signal?.aborted) throw new VastError(504, "vast_timeout", "The VAST request timed out or was cancelled.");
    throw new VastError(502, "vast_unavailable", "VAST could not complete this request. Try again later.");
  }
  return response;
}
