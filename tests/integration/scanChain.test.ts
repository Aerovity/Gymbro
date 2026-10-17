import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_SCAN_JSON, chatOk, httpErr, scanBody, setEnv, stubFetch } from "./helpers";
import type { ScanProvider } from "@/lib/providers/scanChain";
import type { ProviderScan } from "@/lib/providers/scanCommon";

const openai = vi.hoisted(() => ({ responses: { create: vi.fn() } }));
vi.mock("@/lib/providers/openaiClient", () => ({ getOpenAI: () => openai, resetOpenAI: () => undefined }));

const { runScanChain, ScanChainError } = await import("@/lib/providers/scanChain");
const { resetCosmosModelCache } = await import("@/lib/providers/cosmos");

const ev = {
  t_start: 1,
  t_peak: 2,
  t_end: 3,
  issue: "knee_kick",
  body_part: "knees",
  severity: 3,
  confidence: 0.7,
  description: "kick",
};
const result = (provider: ProviderScan["provider"], n: number): ProviderScan => ({
  provider,
  model: `${provider}-model`,
  events: Array.from({ length: n }, () => ev),
  raw: "{}",
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prov = (id: ScanProvider["id"], run: ScanProvider["run"], configured = true): ScanProvider => ({
  id,
  configured: () => configured,
  model: () => `${id}-model`,
  run,
});

describe("runScanChain", () => {
  beforeEach(() => {
    setEnv();
    resetCosmosModelCache();
    openai.responses.create.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("skips unconfigured providers (default chain, only Nemotron configured)", async () => {
    setEnv({ COSMOS_BASE_URL: undefined, OPENAI_API_KEY: undefined });
    const calls = stubFetch(() => chatOk(MODEL_SCAN_JSON));
    const out = await runScanChain(scanBody());
    expect(out.provider).toBe("nemotron");
    expect(out.trace).toHaveLength(1);
    expect(calls.every((c) => c.url.startsWith("http://nvidia.test"))).toBe(true);
    expect(openai.responses.create).not.toHaveBeenCalled();
  });

  it("records timings and errors per attempt", async () => {
    const a = vi.fn(async () => {
      await sleep(30);
      throw new Error("boom");
    });
    const b = vi.fn(async () => {
      await sleep(20);
      return result("nemotron", 2);
    });
    const skipped = vi.fn(async () => result("gpt-fallback", 1));
    const out = await runScanChain(scanBody(), undefined, [
      prov("cosmos", a),
      prov("gpt-fallback", skipped, false),
      prov("nemotron", b),
    ]);
    expect(skipped).not.toHaveBeenCalled();
    expect(out.provider).toBe("nemotron");
    expect(out.trace).toHaveLength(2);
    expect(out.trace[0]).toMatchObject({ step: "scan", provider: "cosmos", model: "cosmos-model", ok: false, error: "boom" });
    expect(out.trace[0].ms).toBeGreaterThanOrEqual(25);
    expect(out.trace[1]).toMatchObject({ provider: "nemotron", ok: true, fallback: true });
    expect(out.trace[1].ms).toBeGreaterThanOrEqual(15);
  });

  it("keeps going after a zero-event result, but returns it if nothing later succeeds", async () => {
    const out = await runScanChain(scanBody(), undefined, [
      prov("cosmos", async () => result("cosmos", 0)),
      prov("nemotron", async () => {
        throw new Error("down");
      }),
    ]);
    expect(out.provider).toBe("cosmos");
    expect(out.events).toHaveLength(0);
    expect(out.trace.map((t) => t.ok)).toEqual([true, false]);
  });

  it("prefers a later result with events over an earlier zero-event result", async () => {
    const out = await runScanChain(scanBody(), undefined, [
      prov("cosmos", async () => result("cosmos", 0)),
      prov("nemotron", async () => result("nemotron", 1)),
      prov("gpt-fallback", async () => result("gpt-fallback", 3)),
    ]);
    expect(out.provider).toBe("nemotron");
    expect(out.trace).toHaveLength(2);
  });

  it("throws ScanChainError with the trace when all fail", async () => {
    const err = await runScanChain(scanBody(), undefined, [
      prov("cosmos", async () => {
        throw new Error("x");
      }),
      prov("nemotron", async () => {
        throw new Error("y");
      }),
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(ScanChainError);
    expect(err.trace).toHaveLength(2);
  });

  it("throws when no provider is configured", async () => {
    setEnv({ COSMOS_BASE_URL: undefined, NVIDIA_API_KEY: undefined, OPENAI_API_KEY: undefined });
    const err = await runScanChain(scanBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ScanChainError);
    expect(err.trace).toHaveLength(0);
  });

  it("discovers the Cosmos model via /v1/models once and caches it", async () => {
    setEnv({ COSMOS_MODEL: undefined, NVIDIA_API_KEY: undefined, OPENAI_API_KEY: undefined });
    const calls = stubFetch((url) =>
      url.endsWith("/v1/models")
        ? new Response(JSON.stringify({ data: [{ id: "other/model" }, { id: "nvidia/cosmos3-super-reasoner" }] }))
        : chatOk(MODEL_SCAN_JSON),
    );
    const a = await runScanChain(scanBody());
    const b = await runScanChain(scanBody());
    expect(a.model).toBe("nvidia/cosmos3-super-reasoner");
    expect(b.model).toBe("nvidia/cosmos3-super-reasoner");
    expect(calls.filter((c) => c.url.endsWith("/v1/models"))).toHaveLength(1);
    expect((calls[1].body as { model: string }).model).toBe("nvidia/cosmos3-super-reasoner");
  });

  it("retries Cosmos once on 503", async () => {
    setEnv({ NVIDIA_API_KEY: undefined, OPENAI_API_KEY: undefined });
    let n = 0;
    stubFetch(() => (++n === 1 ? httpErr(503) : chatOk(MODEL_SCAN_JSON)));
    const out = await runScanChain(scanBody());
    expect(out.provider).toBe("cosmos");
    expect(n).toBe(2);
  });
});
