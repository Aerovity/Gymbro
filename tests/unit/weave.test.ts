import { afterEach, describe, expect, it, vi } from "vitest";
import { exportSponsorTrace } from "@/lib/observability/exporter";
import { evaluateSponsorPolicies } from "@/lib/observability/evaluation";
import { classifyTraceError, readWeaveConfig, sanitiseTrace, type SponsorTrace } from "@/lib/observability/trace";
import { getWeaveStatus, recordSponsorTrace } from "@/lib/observability/weave";
import { APIConnectionError, APIConnectionTimeoutError } from "openai";

const event: SponsorTrace = { operation: "scan", provider: "cosmos", model: "nvidia/cosmos-test", mode: "live", durationMs: 123.4, outcome: "success" };
const config = () => readWeaveConfig({ WEAVE_ENABLED: "1", WEAVE_PROJECT: "test-team/gymbro", WANDB_API_KEY: "test-key-not-live" });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("metadata-only Weave exporter", () => {
  it("does not touch the network unless explicitly enabled and configured", async () => {
    const fetcher = vi.fn();
    expect(await exportSponsorTrace(event, readWeaveConfig({ WANDB_API_KEY: "test" }), fetcher)).toEqual({ status: "disabled" });
    expect(await exportSponsorTrace(event, readWeaveConfig({ WEAVE_ENABLED: "1" }), fetcher)).toEqual({ status: "failed", reason: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts matching start/end IDs, timestamps and documented Basic authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response());
    expect(await exportSponsorTrace(event, config(), fetcher)).toEqual({ status: "sent" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [startUrl, startRequest] = fetcher.mock.calls[0];
    const [endUrl, endRequest] = fetcher.mock.calls[1];
    expect(startUrl).toBe("https://trace.wandb.ai/call/start");
    expect(endUrl).toBe("https://trace.wandb.ai/call/end");
    expect(startRequest).toMatchObject({ method: "POST", cache: "no-store", redirect: "error",
      headers: { Authorization: `Basic ${Buffer.from("api:test-key-not-live").toString("base64")}`, "Content-Type": "application/json" } });
    const { start } = JSON.parse(String(startRequest?.body));
    const { end } = JSON.parse(String(endRequest?.body));
    expect(start.project_id).toBe("test-team/gymbro");
    expect(start.id).toBe(start.trace_id);
    expect(end.id).toBe(start.id);
    expect(Date.parse(end.ended_at) - Date.parse(start.started_at)).toBe(123);
    expect(start.inputs).toEqual({});
    expect(end.output).toBeNull();
    expect(start.attributes).toMatchObject({ provider: "cosmos", model: "nvidia/cosmos-test", mode: "live", content_capture: false });
  });

  it("never serialises extra fields, messages, frames or secret-shaped model values", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response());
    const malicious = { ...event, prompt: "SECRET_PROMPT", frames: ["data:image/jpeg;base64,PRIVATE"],
      error: { message: "SECRET_MESSAGE", stack: "SECRET_STACK" }, model: "sk-private-key", apiKey: "SECRET_KEY" };
    await exportSponsorTrace(malicious, config(), fetcher);
    const bodies = fetcher.mock.calls.map((call) => String(call[1]?.body)).join("");
    for (const value of ["SECRET", "PRIVATE", "sk-private", "test-key-not-live"]) expect(bodies).not.toContain(value);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).start.attributes).not.toHaveProperty("model");
    await exportSponsorTrace({ ...event, model: "test-key-not-live" }, config(), fetcher);
    expect(String(fetcher.mock.calls[2][1]?.body)).not.toContain("test-key-not-live");
  });

  it.each([401, 429, 500])("stops at a failed start (%s), without reading response content or retrying", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("SECRET_RESPONSE", { status }));
    expect(await exportSponsorTrace(event, config(), fetcher)).toEqual({ status: "failed", reason: "http" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a failed end instead of falsely claiming a complete trace", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response()).mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await exportSponsorTrace(event, config(), fetcher)).toEqual({ status: "failed", reason: "http" });
  });

  it("contains network errors without exposing their text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("SECRET_ENDPOINT_AND_PROMPT"));
    expect(await exportSponsorTrace(event, config(), fetcher)).toEqual({ status: "failed", reason: "network" });
  });

  it("enforces one deadline across both requests, even if fetch ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response())
      .mockImplementationOnce(() => new Promise(() => undefined));
    const pending = exportSponsorTrace(event, { ...config(), timeoutMs: 100 }, fetcher);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ status: "failed", reason: "timeout" });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not send end after a timed-out start eventually resolves", async () => {
    vi.useFakeTimers();
    let resolveStart!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));
    const pending = exportSponsorTrace(event, { ...config(), timeoutMs: 100 }, fetcher);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ status: "failed", reason: "timeout" });
    resolveStart(new Response());
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown event labels and invalid durations without network access", async () => {
    const fetcher = vi.fn();
    for (const bad of [{ ...event, durationMs: -1 }, { ...event, durationMs: Infinity }, { ...event, provider: "PRIVATE_TEXT" }]) {
      expect(await exportSponsorTrace(bad as SponsorTrace, config(), fetcher)).toEqual({ status: "failed", reason: "invalid_metadata" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("records fallback and mock mode without implying live inference", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response());
    await exportSponsorTrace({ ...event, mode: "mock", outcome: "fallback", errorCategory: "timeout" }, config(), fetcher);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).start.attributes)
      .toMatchObject({ mode: "mock", outcome: "fallback", errorCategory: "timeout" });
  });

  it("restricts synthetic evaluation counts to bounded values and the evaluation operation", () => {
    expect(sanitiseTrace({ ...event, evaluation: { passed: 1, total: 2 } })).not.toHaveProperty("evaluation");
    const synthetic: SponsorTrace = { ...event, operation: "evaluation", mode: "synthetic", evaluation: { passed: 2, total: 2 } };
    expect(sanitiseTrace(synthetic)?.evaluation).toEqual({ passed: 2, total: 2 });
    expect(sanitiseTrace({ ...synthetic, evaluation: { passed: 3, total: 2 } })).not.toHaveProperty("evaluation");
  });
});

describe("Weave configuration and public helper", () => {
  it.each(["http://trace.wandb.ai", "https://user:secret@trace.wandb.ai", "https://trace.wandb.ai?key=secret", "https://trace.wandb.ai#secret", "not a url"])("rejects unsafe destination %s", (baseUrl) => {
    expect(readWeaveConfig({ WEAVE_TRACE_BASE_URL: baseUrl }).baseUrl).toBeUndefined();
  });
  it("supports a self-managed HTTPS path and bounds timeouts", () => {
    expect(readWeaveConfig({ WEAVE_TRACE_BASE_URL: "https://team.wandb.io/traces/", WEAVE_TIMEOUT_MS: "999999" }))
      .toMatchObject({ baseUrl: "https://team.wandb.io/traces", timeoutMs: 2000 });
    expect(readWeaveConfig({ WEAVE_TIMEOUT_MS: "1" }).timeoutMs).toBe(100);
    expect(readWeaveConfig({ WEAVE_TIMEOUT_MS: "invalid" }).timeoutMs).toBe(750);
  });
  it("exposes only enabled/configured state and defaults to no export", async () => {
    vi.stubEnv("WEAVE_ENABLED", "0");
    vi.stubEnv("WEAVE_PROJECT", "test-team/gymbro");
    vi.stubEnv("WANDB_API_KEY", "SECRET");
    vi.stubEnv("WEAVE_TRACE_BASE_URL", "https://trace.wandb.ai");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(getWeaveStatus()).toEqual({ enabled: false, configured: true });
    expect(await recordSponsorTrace(event)).toEqual({ status: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[{ name: "AbortError" }, "timeout"], [{ status: 403 }, "auth"], [{ status: 429 }, "rate_limit"],
    [{ name: "ZodError" }, "invalid_response"], [{ name: "CoachParseError", raw: "PRIVATE_FRAME" }, "invalid_response"],
    [new APIConnectionTimeoutError({ message: "SECRET" }), "timeout"], [new APIConnectionError({ message: "SECRET" }), "network"],
    [new TypeError("SECRET"), "network"], [new Error("SECRET"), "unknown"]])
    ("classifies bounded error category", (error, expected) => expect(classifyTraceError(error)).toBe(expected));
});

it("runs a synthetic policy evaluation without touching the real network", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const result = await evaluateSponsorPolicies();
  expect(result.passed).toBe(result.total);
  expect(result.total).toBeGreaterThanOrEqual(8);
  expect(result).toMatchObject({ scope: "synthetic-contract-policy", videoAccuracyMeasured: false, providerInferencePerformed: false });
  expect(fetcher).not.toHaveBeenCalled();
});
