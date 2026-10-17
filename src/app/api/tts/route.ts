import { isMock, providersConfigured, serverConfig } from "@/lib/config";
import { TtsRequestSchema } from "@/lib/schemas";
import { getOpenAI } from "@/lib/providers/openaiClient";
import { safeErrorMessage } from "@/lib/providers/http";
import { NO_STORE, jsonError, readBody } from "../_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const body = await readBody(req, TtsRequestSchema);
  if (!body.ok) return body.response;

  const cfg = serverConfig();
  // Mock mode and unconfigured TTS → the client uses browser speechSynthesis.
  if (isMock() || !providersConfigured(cfg).tts) {
    return jsonError(501, "tts_not_configured", "Server TTS is not configured; use browser speech");
  }

  try {
    const res = await getOpenAI().audio.speech.create(
      { model: cfg.OPENAI_TTS_MODEL, voice: cfg.OPENAI_TTS_VOICE, input: body.data.text, response_format: "mp3" },
      { signal: req.signal, timeout: 20_000, maxRetries: 0 },
    );
    const audio = await res.arrayBuffer();
    return new Response(audio, { headers: { ...NO_STORE, "Content-Type": "audio/mpeg" } });
  } catch (e) {
    return jsonError(502, "tts_failed", safeErrorMessage(e));
  }
}
