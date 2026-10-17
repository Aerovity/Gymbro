import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_SCAN_JSON, SECRETS, chatOk, headerOf, httpErr, post, scanBody, setEnv, stubFetch } from "./helpers";

const openai = vi.hoisted(() => ({
  responses: { create: vi.fn() },
  images: { edit: vi.fn() },
  models: { retrieve: vi.fn() },
}));
vi.mock("@/lib/providers/openaiClient", () => ({ getOpenAI: () => openai, resetOpenAI: () => undefined }));

const { POST } = await import("@/app/api/scan/route");

const isCosmos = (url: string) => url.startsWith("http://cosmos.test");
const isNvidia = (url: string) => url.startsWith("http://nvidia.test");

describe("POST /api/scan", () => {
  beforeEach(() => {
    setEnv();
    openai.responses.create.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Cosmos 200 → provider cosmos with video_frames and fps", async () => {
    const calls = stubFetch((url) => (isCosmos(url) ? chatOk(MODEL_SCAN_JSON) : httpErr(500)));
    const res = await POST(post("/api/scan", scanBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json.provider).toBe("cosmos");
    expect(json.model).toBe("nvidia/cosmos3-nano-reasoner");
    expect(json.events).toHaveLength(1);
    // snapped to a sampled frame time
    expect(json.events[0].t_peak).toBe(7.125);
    expect(json.trace).toHaveLength(1);
    expect(json.trace[0]).toMatchObject({ step: "scan", provider: "cosmos", ok: true });
    expect(typeof json.trace[0].ms).toBe("number");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://cosmos.test/v1/chat/completions");
    expect(headerOf(calls[0].init, "authorization")).toBe(`Bearer ${SECRETS.cosmos}`);
    const body = calls[0].body as {
      messages: { content: unknown }[];
      media_io_kwargs: { video: { fps: number } };
      max_tokens: number;
    };
    expect(body.media_io_kwargs.video.fps).toBe(2.67);
    expect(body.max_tokens).toBe(1500);
    const parts = body.messages[1].content as { type: string; video_frames?: string[] }[];
    expect(parts[0].type).toBe("video_frames");
    expect(parts[0].video_frames).toHaveLength(40);
    expect(parts.at(-1)?.type).toBe("text");
    expect(openai.responses.create).not.toHaveBeenCalled();
  });

  it("reasoning toggle appends the <think> instruction and raises max_tokens", async () => {
    setEnv({ COSMOS_REASONING: "1" });
    const calls = stubFetch(() => chatOk(`<think>hmm</think>${MODEL_SCAN_JSON}`));
    const res = await POST(post("/api/scan", scanBody()));
    expect((await res.json()).provider).toBe("cosmos");
    const body = calls[0].body as { max_tokens: number; messages: { content: { type: string; text?: string }[] }[] };
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[1].content.at(-1)?.text).toContain("<think>");
  });

  it("Cosmos 404 → falls to Nemotron (12 image frames, no thinking, poll header)", async () => {
    const calls = stubFetch((url) => {
      if (isCosmos(url)) return httpErr(404, "Function not found for account");
      if (isNvidia(url)) return chatOk("```json\n" + MODEL_SCAN_JSON + "\n```");
      return httpErr(500);
    });
    const res = await POST(post("/api/scan", scanBody()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.provider).toBe("nemotron");
    expect(json.trace.map((t: { provider: string; ok: boolean }) => [t.provider, t.ok])).toEqual([
      ["cosmos", false],
      ["nemotron", true],
    ]);
    expect(json.trace[0].error).toContain("404");

    const nv = calls.find((c) => isNvidia(c.url))!;
    expect(nv.url).toBe("http://nvidia.test/v1/chat/completions");
    expect(headerOf(nv.init, "NVCF-POLL-SECONDS")).toBe("1800");
    expect(headerOf(nv.init, "authorization")).toBe(`Bearer ${SECRETS.nvidia}`);
    const body = nv.body as {
      model: string;
      temperature: number;
      chat_template_kwargs: { enable_thinking: boolean };
      messages: { content: { type: string; text?: string }[] }[];
    };
    expect(body.model).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
    expect(body.temperature).toBe(0);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    const parts = body.messages[1].content;
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(12);
    expect(parts.at(-1)?.text).toMatch(/timestamps \(seconds\) are: 0, /);
    // Cosmos 404 is not retried
    expect(calls.filter((c) => isCosmos(c.url))).toHaveLength(1);
  });

  it("Cosmos and Nemotron fail → GPT contact-sheet fallback", async () => {
    stubFetch(() => httpErr(400, "bad"));
    openai.responses.create.mockResolvedValue({ output_text: MODEL_SCAN_JSON.replace('"rep_index":3', '"rep_index":null') });
    const body = scanBody({ contactSheetDataUrl: "data:image/jpeg;base64,SHEET", contactSheetTimestamps: [1, 4, 7, 10] });
    const res = await POST(post("/api/scan", body));
    const json = await res.json();
    expect(json.provider).toBe("gpt-fallback");
    expect(json.trace).toHaveLength(3);
    expect(json.trace[2]).toMatchObject({ provider: "gpt-fallback", ok: true, fallback: true });
    expect(json.events[0].t_peak).toBe(7);

    const [params, options] = openai.responses.create.mock.calls[0];
    expect(params.text.format).toMatchObject({ type: "json_schema", strict: true, name: "scan_output" });
    const content = params.input[0].content;
    expect(content[1]).toEqual({ type: "input_image", image_url: "data:image/jpeg;base64,SHEET", detail: "high" });
    expect(options.timeout).toBe(30_000);
  });

  it("all providers fail → 502 with a 3-entry trace and no leaked keys", async () => {
    stubFetch((url) =>
      isCosmos(url) ? httpErr(401, `invalid token ${SECRETS.cosmos}`) : httpErr(403, `Bearer ${SECRETS.nvidia} rejected`),
    );
    openai.responses.create.mockRejectedValue(new Error(`Incorrect API key provided: ${SECRETS.openai}`));
    const res = await POST(post("/api/scan", scanBody()));
    expect(res.status).toBe(502);
    const text = await res.text();
    for (const s of Object.values(SECRETS)) expect(text).not.toContain(s);
    const json = JSON.parse(text);
    expect(json.error.code).toBe("scan_failed");
    expect(json.trace).toHaveLength(3);
    expect(json.trace.every((t: { ok: boolean }) => !t.ok)).toBe(true);
    expect(json.trace.map((t: { provider: string }) => t.provider)).toEqual(["cosmos", "nemotron", "gpt-fallback"]);
  });

  it("4.6 MB payload → 413 JSON", async () => {
    const big = "data:image/jpeg;base64," + "A".repeat(4.6 * 1024 * 1024);
    const res = await POST(post("/api/scan", scanBody({ frames: [{ t: 0, dataUrl: big }] })));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });

  it("video_frames 422 → retried once in image_frames mode", async () => {
    const calls = stubFetch((url, init) => {
      const body = JSON.parse(String(init.body));
      const first = body.messages[1].content[0];
      if (isCosmos(url) && first.type === "video_frames") return httpErr(422, "unknown content type video_frames");
      if (isCosmos(url)) return chatOk(MODEL_SCAN_JSON);
      return httpErr(500);
    });
    const res = await POST(post("/api/scan", scanBody()));
    const json = await res.json();
    expect(json.provider).toBe("cosmos");
    expect(json.trace).toHaveLength(1);
    expect(json.trace[0].detail).toContain("image_frames");
    const cosmosCalls = calls.filter((c) => isCosmos(c.url));
    expect(cosmosCalls).toHaveLength(2);
    const retry = cosmosCalls[1].body as { media_io_kwargs?: unknown; messages: { content: { type: string; text?: string }[] }[] };
    expect(retry.media_io_kwargs).toBeUndefined();
    expect(retry.messages[1].content.filter((p) => p.type === "image_url")).toHaveLength(40);
    expect(retry.messages[1].content.at(-1)?.text).toContain("Their timestamps (seconds) are:");
  });

  it("invalid body → 400 with an issues summary", async () => {
    const res = await POST(post("/api/scan", { exercise: "yoga", frames: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("invalid_request");
    expect(json.error.message).toMatch(/exercise/);
  });

  it("non-JSON body → 400", async () => {
    const res = await POST(post("/api/scan", "not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });

  it("MOCK_AI → demo fixture without calling providers", async () => {
    setEnv({ MOCK_AI: "1" });
    const calls = stubFetch(() => httpErr(500));
    const res = await POST(post("/api/scan", scanBody()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.provider).toBe("demo");
    expect(json.events.length).toBeGreaterThanOrEqual(1);
    expect(json.trace[0]).toMatchObject({ provider: "demo", ok: true });
    expect(calls).toHaveLength(0);
  });
});
