import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getVastConfig, VastError, type VastConfig } from "./config";
import { checkedFetch, readJson, readLimited, requestSignal } from "./http";
import type { VastSearchResponse } from "./types";

export const VastSearchInput = z.object({ query: z.string().trim().min(3).max(500), limit: z.number().int().min(1).max(10).default(5) }).strict();
const sourceSchema = z.string().max(1500).regex(/^s3:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/[^\s\x00-\x1f?#]+$/);
const hitSchema = z.object({ source: sourceSchema, similarity_score: z.number().finite().min(-1).max(1), reasoning_content: z.string().max(20_000).nullish() });
const chunkSchema = z.object({ preview_source: z.string(), best_match_start_sec: z.number().finite().nonnegative(), best_match_end_sec: z.number().finite().nonnegative() });
const TICKET_TTL_MS = 10 * 60_000;
export const MAX_CLIP_BYTES = 8 * 1024 * 1024;
let session: { key: string; token: string; expiresAt: number } | undefined;

function endpoint(config: VastConfig, path: string): URL { return new URL(`${config.baseUrl}${path}`); }
function sessionKey(config: VastConfig): string { return config.signingKey.toString("hex"); }

async function tokenFor(config: VastConfig, signal: AbortSignal, refresh = false): Promise<string> {
  if (config.token) return config.token;
  const key = sessionKey(config);
  if (!refresh && session?.key === key && session.expiresAt > Date.now()) return session.token;
  const response = await checkedFetch(endpoint(config, "/api/v1/auth/login"), {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new VastError(502, "vast_auth_failed", "VAST authentication failed. Check the server connection settings.");
  }
  const parsed = z.object({ access_token: z.string().min(1).max(8192).regex(/^\S+$/), token_type: z.string().optional() }).safeParse(await readJson(response, 16 * 1024));
  if (!parsed.success) throw new VastError(502, "vast_invalid_response", "VAST returned an invalid authentication response.");
  session = { key, token: parsed.data.access_token, expiresAt: Date.now() + 60_000 };
  return session.token;
}

async function authorisedRequest(config: VastConfig, signal: AbortSignal, makeRequest: (token: string) => Promise<Response>): Promise<Response> {
  let response = await makeRequest(await tokenFor(config, signal));
  if (response.status === 401 && !config.token) {
    await response.body?.cancel();
    response = await makeRequest(await tokenFor(config, signal, true));
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new VastError(502, "vast_auth_failed", "VAST did not authorise this request. Check the server connection settings.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new VastError(502, "vast_unavailable", "VAST could not complete this request. Try again later.");
  }
  return response;
}

function ticketFor(source: string, config: VastConfig): string {
  const iv = randomBytes(12);
  const encryptionKey = createHmac("sha256", config.signingKey).update("gymbro-vast-ticket-encryption").digest();
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ source, expires: Date.now() + TICKET_TTL_MS })), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  return `${payload}.${createHmac("sha256", config.signingKey).update(payload).digest("base64url")}`;
}

function sourceFromTicket(ticket: string, config: VastConfig): string {
  const invalid = () => new VastError(400, "vast_invalid_clip", "This clip link is invalid or has expired. Run the search again.");
  if (ticket.length > 2400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) throw invalid();
  const [payload, signature] = ticket.split(".");
  const expected = createHmac("sha256", config.signingKey).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let data: unknown;
  try {
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.length < 29) throw invalid();
    const encryptionKey = createHmac("sha256", config.signingKey).update("gymbro-vast-ticket-encryption").digest();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  } catch { throw invalid(); }
  const parsed = z.object({ source: sourceSchema, expires: z.number().int() }).strict().safeParse(data);
  if (!parsed.success || parsed.data.expires <= Date.now() || parsed.data.expires > Date.now() + TICKET_TTL_MS) throw invalid();
  return parsed.data.source;
}

export async function searchVast(input: z.infer<typeof VastSearchInput>, callerSignal?: AbortSignal): Promise<VastSearchResponse> {
  const config = getVastConfig();
  const signal = requestSignal(callerSignal);
  const response = await authorisedRequest(config, signal, (token) => checkedFetch(endpoint(config, "/api/v1/search"), {
    method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: input.query, top_k: input.limit, llm_top_n: 1, min_similarity: 0.3, tags: [config.workoutTag], time_filter: "all", include_public: false }),
  }));
  const parsed = z.object({ results: z.array(hitSchema).max(100), chunk_results: z.array(z.unknown()).max(100).optional() }).safeParse(await readJson(response));
  if (!parsed.success) throw new VastError(502, "vast_invalid_response", "VAST returned invalid search results.");
  const chunks = (parsed.data.chunk_results ?? []).map((chunk) => chunkSchema.safeParse(chunk)).filter((chunk) => chunk.success).map((chunk) => chunk.data);
  const seen = new Set<string>();
  const results = parsed.data.results.filter((hit) => { if (seen.has(hit.source)) return false; seen.add(hit.source); return true; }).slice(0, input.limit).map((hit) => {
    const timing = chunks.find((chunk) => chunk.preview_source === hit.source && chunk.best_match_end_sec >= chunk.best_match_start_sec);
    const filename = hit.source.split("/").pop() ?? "Workout clip";
    return {
      id: createHash("sha256").update(hit.source).digest("hex").slice(0, 16),
      title: filename.slice(0, 160), description: (hit.reasoning_content ?? "").slice(0, 2000), similarity: hit.similarity_score,
      ...(timing ? { startSeconds: timing.best_match_start_sec, endSeconds: timing.best_match_end_sec } : {}),
      playbackUrl: `/api/vast/clip?ticket=${ticketFor(hit.source, config)}`,
    };
  });
  return { provider: "vast", results, searchedAt: new Date().toISOString() };
}

type ClipRange = { start: number; end: number; suffix?: never } | { start?: never; end?: never; suffix: number };

function clipRange(value: string | null): ClipRange {
  if (!value) return { start: 0, end: MAX_CLIP_BYTES - 1 };
  const suffixMatch = /^bytes=-(\d+)$/.exec(value);
  if (suffixMatch) {
    const suffix = Number(suffixMatch[1]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new VastError(416, "vast_invalid_range", "Request a valid single video range.");
    return { suffix: Math.min(suffix, MAX_CLIP_BYTES) };
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  const start = Number(match?.[1]);
  const end = match?.[2] ? Number(match[2]) : start + MAX_CLIP_BYTES - 1;
  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw new VastError(416, "vast_invalid_range", "Request a valid single video range.");
  return { start, end: Math.min(end, start + MAX_CLIP_BYTES - 1) };
}

export async function streamVastClip(ticket: string, rangeHeader: string | null, callerSignal?: AbortSignal): Promise<Response> {
  const config = getVastConfig();
  const source = sourceFromTicket(ticket, config);
  const range = clipRange(rangeHeader);
  const signal = requestSignal(callerSignal, 15_000);
  const response = await authorisedRequest(config, signal, (token) => {
    const url = endpoint(config, "/api/v1/videos/stream");
    url.searchParams.set("source", source);
    url.searchParams.set("token", token);
    return checkedFetch(url, { signal, headers: { Range: range.suffix !== undefined ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.end}` } });
  });
  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (!contentType || !["video/mp4", "video/webm", "video/quicktime", "application/octet-stream"].includes(contentType)) {
    await response.body?.cancel();
    throw new VastError(502, "vast_invalid_clip", "VAST did not return a supported video clip.");
  }
  const contentRange = response.headers.get("content-range");
  const parts = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  const [returnedStart, returnedEnd, total] = parts ? parts.slice(1).map(Number) : [];
  const validRange = parts && [returnedStart, returnedEnd, total].every(Number.isSafeInteger) && returnedEnd >= returnedStart && total > returnedEnd &&
    (range.suffix !== undefined ? returnedStart === Math.max(0, total - range.suffix) && returnedEnd === total - 1 : returnedStart === range.start && returnedEnd <= range.end);
  if (response.status === 206 && !validRange) {
    await response.body?.cancel();
    throw new VastError(502, "vast_invalid_clip", "VAST returned an invalid video range.");
  }
  if (response.status !== 200 && response.status !== 206 || response.status === 200 && range.start !== undefined && range.start !== 0) {
    await response.body?.cancel();
    throw new VastError(502, "vast_invalid_clip", "VAST did not return the requested video range.");
  }
  const bytes = await readLimited(response.body, range.suffix ?? MAX_CLIP_BYTES);
  if (parts && bytes.length !== Number(parts[2]) - Number(parts[1]) + 1) throw new VastError(502, "vast_invalid_clip", "VAST returned an incomplete video range.");
  return new Response(bytes as BodyInit, { status: response.status, headers: {
    "Content-Type": contentType, "Content-Length": String(bytes.length), "Cache-Control": "no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
    ...(response.status === 206 && contentRange ? { "Content-Range": contentRange } : {}),
  } });
}
