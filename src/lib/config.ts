// Server-side configuration. Import ONLY from route handlers / server providers.
// Read lazily (function, not module constant) so tests can mutate process.env.
import "server-only";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
};
const flag = (v: string | undefined) => v === "1" || v === "true";
const str = (v: string | undefined, d = "") => (v ?? "").trim() || d;

export function serverConfig() {
  const e = process.env;
  return {
    DEMO_MODE: flag(e.DEMO_MODE),
    MOCK_AI: flag(e.MOCK_AI),

    COSMOS_BASE_URL: str(e.COSMOS_BASE_URL).replace(/\/+$/, "").replace(/\/v1$/, ""),
    COSMOS_API_KEY: str(e.COSMOS_API_KEY),
    COSMOS_MODEL: str(e.COSMOS_MODEL),
    COSMOS_INPUT_MODE: str(e.COSMOS_INPUT_MODE, "video_frames") as "video_frames" | "video_url" | "image_frames",
    COSMOS_FPS: num(e.COSMOS_FPS, 4),
    COSMOS_TIMEOUT_MS: num(e.COSMOS_TIMEOUT_MS, 35_000),
    COSMOS_REASONING: flag(e.COSMOS_REASONING),

    NVIDIA_API_KEY: str(e.NVIDIA_API_KEY),
    NVIDIA_BASE_URL: str(e.NVIDIA_BASE_URL, "https://integrate.api.nvidia.com/v1").replace(/\/+$/, ""),
    NEMOTRON_MODEL: str(e.NEMOTRON_MODEL, "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"),
    NEMOTRON_TIMEOUT_MS: num(e.NEMOTRON_TIMEOUT_MS, 40_000),

    OPENAI_API_KEY: str(e.OPENAI_API_KEY),
    OPENAI_COACH_MODEL: str(e.OPENAI_COACH_MODEL, "gpt-6.1-sol"),
    OPENAI_PICK_MODEL: str(e.OPENAI_PICK_MODEL, "gpt-6.1-sol"),
    OPENAI_IMAGE_MODEL: str(e.OPENAI_IMAGE_MODEL, "gpt-image-2.5-flare"),
    OPENAI_IMAGE_QUALITY: str(e.OPENAI_IMAGE_QUALITY, "medium"),
    OPENAI_IMAGE_INPUT_FIDELITY: str(e.OPENAI_IMAGE_INPUT_FIDELITY),
    OPENAI_TTS_MODEL: str(e.OPENAI_TTS_MODEL),
    OPENAI_TTS_VOICE: str(e.OPENAI_TTS_VOICE, "onyx"),
    OPENAI_TIMEOUT_MS: num(e.OPENAI_TIMEOUT_MS, 60_000),

    WANDB_API_KEY: str(e.WANDB_API_KEY),
    YOLO_URL: str(e.YOLO_URL),
  };
}
export type ServerConfig = ReturnType<typeof serverConfig>;

/** True when routes should return fixtures instead of calling AI providers. */
export const isMock = () => {
  const c = serverConfig();
  return c.MOCK_AI || c.DEMO_MODE;
};

export const providersConfigured = (c = serverConfig()) => ({
  cosmos: !!c.COSMOS_BASE_URL,
  nemotron: !!c.NVIDIA_API_KEY,
  openai: !!c.OPENAI_API_KEY,
  tts: !!c.OPENAI_API_KEY && !!c.OPENAI_TTS_MODEL,
});
