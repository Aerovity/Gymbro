// Lazy OpenAI client singleton built from serverConfig().
import "server-only";
import OpenAI from "openai";
import { serverConfig } from "@/lib/config";

let client: OpenAI | null = null;
let clientKey = "";

/** Returns a shared OpenAI client. Rebuilt if the API key changes (tests mutate env). */
export function getOpenAI(): OpenAI {
  const cfg = serverConfig();
  if (!cfg.OPENAI_API_KEY) throw new Error("OpenAI is not configured (OPENAI_API_KEY missing)");
  if (!client || clientKey !== cfg.OPENAI_API_KEY) {
    // We control retries ourselves; per-request `timeout` overrides this default.
    client = new OpenAI({ apiKey: cfg.OPENAI_API_KEY, maxRetries: 0, timeout: cfg.OPENAI_TIMEOUT_MS });
    clientKey = cfg.OPENAI_API_KEY;
  }
  return client;
}

export function resetOpenAI() {
  client = null;
  clientKey = "";
}
