import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthResponseSchema } from "@/lib/schemas";
import { SECRETS, setEnv, stubFetch } from "./helpers";

const openai = vi.hoisted(() => ({ models: { retrieve: vi.fn() } }));
vi.mock("@/lib/providers/openaiClient", () => ({ getOpenAI: () => openai, resetOpenAI: () => undefined }));

const { GET } = await import("@/app/api/health/route");
const { POST: TTS } = await import("@/app/api/tts/route");
const { POST: PICK } = await import("@/app/api/pick-frame/route");

describe("GET /api/health", () => {
  beforeEach(() => {
    setEnv();
    openai.models.retrieve.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports configured providers without probing", async () => {
    setEnv({ NVIDIA_API_KEY: undefined });
    const calls = stubFetch(() => new Response("{}"));
    const res = await GET(new Request("http://x/api/health"));
    const json = HealthResponseSchema.parse(await res.json());
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(json).toMatchObject({
      ok: true,
      demo: false,
      mock: false,
      providers: { cosmos: true, nemotron: false, openai: true, tts: false },
    });
    expect(json.probe).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("?probe=1 pings Cosmos /v1/models and OpenAI models.retrieve", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ data: [{ id: "nvidia/cosmos3-nano-reasoner" }] })));
    openai.models.retrieve.mockResolvedValue({ id: "gpt-6.1-sol" });
    const json = HealthResponseSchema.parse(await (await GET(new Request("http://x/api/health?probe=1"))).json());
    expect(calls[0].url).toBe("http://cosmos.test/v1/models");
    expect(json.probe?.cosmos).toMatchObject({ ok: true });
    expect(json.probe?.cosmos.detail).toContain("cosmos3");
    expect(json.probe?.openai).toMatchObject({ ok: true });
    expect(openai.models.retrieve.mock.calls[0][0]).toBe("gpt-6.1-sol");
    expect(openai.models.retrieve.mock.calls[0][1]).toMatchObject({ timeout: 4000, maxRetries: 0 });
  });

  it("probe failures are reported without leaking keys", async () => {
    stubFetch(() => new Response(`bad token ${SECRETS.cosmos}`, { status: 401 }));
    openai.models.retrieve.mockRejectedValue(new Error(`Incorrect API key ${SECRETS.openai}`));
    const res = await GET(new Request("http://x/api/health?probe=1"));
    const text = await res.text();
    for (const s of Object.values(SECRETS)) expect(text).not.toContain(s);
    const json = JSON.parse(text);
    expect(res.status).toBe(200);
    expect(json.probe.cosmos.ok).toBe(false);
    expect(json.probe.openai.ok).toBe(false);
  });

  it("mock flag reflects MOCK_AI / DEMO_MODE", async () => {
    setEnv({ DEMO_MODE: "1" });
    const json = await (await GET(new Request("http://x/api/health"))).json();
    expect(json.demo).toBe(true);
    expect(json.mock).toBe(true);
  });
});

describe("POST /api/tts and /api/pick-frame (smoke)", () => {
  beforeEach(() => setEnv());

  it("tts without a model → 501 so the client uses browser speech", async () => {
    const res = await TTS(new Request("http://x/api/tts", { method: "POST", body: JSON.stringify({ text: "hello" }) }));
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("tts_not_configured");
  });

  it("pick-frame in mock mode returns the demo scan", async () => {
    setEnv({ MOCK_AI: "1" });
    const res = await PICK(
      new Request("http://x/api/pick-frame", {
        method: "POST",
        body: JSON.stringify({
          exercise: "auto",
          duration: 15,
          contactSheetDataUrl: "data:image/jpeg;base64,AAAA",
          timestamps: [1, 2, 3],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).provider).toBe("demo");
  });
});
