import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { VastStatus } from "./types";

export class VastError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "VastError";
  }
}

export interface VastConfig {
  baseUrl: string;
  workoutTag: string;
  token?: string;
  username?: string;
  password?: string;
  accessKey: string;
  signingKey: Buffer;
}

export function getVastConfig(): VastConfig {
  const unavailable = () => new VastError(503, "vast_not_configured", "Workout search needs a configured VAST connection and indexed gym dataset.");
  if (process.env.VAST_ENABLED !== "1") throw unavailable();
  const base = process.env.VAST_BASE_URL?.trim();
  const workoutTag = process.env.VAST_WORKOUT_TAG?.trim();
  const token = process.env.VAST_BEARER_TOKEN?.trim();
  const username = process.env.VAST_USERNAME?.trim();
  const password = process.env.VAST_PASSWORD;
  const accessKey = process.env.VAST_APP_ACCESS_KEY;
  if (!base || !workoutTag || workoutTag.length > 100 || !accessKey || accessKey.length < 32 || accessKey.length > 512 || (!token && (!username || !password))) throw unavailable();
  let url: URL;
  try { url = new URL(base); } catch { throw unavailable(); }
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && process.env.VAST_ALLOW_HTTP === "1"))) throw unavailable();
  if (token && (/\s/.test(token) || token.length > 8192)) throw unavailable();
  const baseUrl = url.href.replace(/\/$/, "");
  // Bind playback tickets to the configured account, dataset and endpoint. They
  // are evidence handles, not an application login or a per-user access boundary.
  const signingKey = createHash("sha256").update(JSON.stringify([accessKey, baseUrl, workoutTag, token ?? username, token ?? password])).digest();
  return { baseUrl, workoutTag, token, username, password, accessKey, signingKey };
}

export function requireVastAccess(request: Request): void {
  const config = getVastConfig();
  const supplied = request.headers.get("x-vast-access-key") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (supplied.length > 512 || !timingSafeEqual(digest(supplied), digest(config.accessKey))) {
    throw new VastError(401, "vast_access_required", "Enter the team access key to search this workout archive.");
  }
}

export function vastStatus(): VastStatus {
  let configured = false;
  try { getVastConfig(); configured = true; } catch { /* configuration only; no remote probe */ }
  return { provider: "vast", enabled: process.env.VAST_ENABLED === "1", configured };
}

export function vastErrorResponse(error: unknown): Response {
  const safe = error instanceof VastError ? error : new VastError(502, "vast_unavailable", "VAST could not complete this request. Try again later.");
  return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
}
