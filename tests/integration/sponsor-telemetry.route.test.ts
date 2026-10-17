import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorrectRequest } from "@/lib/schemas";
import type { ScanProvider } from "@/lib/providers/scanChain";
import { COACH_REPORT, JPEG, coachBody, post, readEvents, scanBody, setEnv } from "./helpers";

const mocks = vi.hoisted(() => ({
  exportTrace: vi.fn(),
  coach: vi.fn(),
  correct: vi.fn(),
}));
vi.mock("@/lib/observability/exporter", () => ({
  exportSponsorTrace: mocks.exportTrace,
}));
vi.mock("@/lib/providers/openaiCoach", () => ({ runCoach: mocks.coach }));
vi.mock("@/lib/providers/openaiImage", () => ({ editImage: mocks.correct }));

const { runScanChain } = await import("@/lib/providers/scanChain");
const { POST: scan } = await import("@/app/api/scan/route");
const { POST: coach } = await import("@/app/api/coach/route");
const { POST: correct } = await import("@/app/api/correct/route");
const { GET: health } = await import("@/app/api/health/route");
const { safeErrorMessage, TimeoutError } = await import("@/lib/providers/http");

const correction: CorrectRequest = {
  exercise: "pull_up",
  beforeDataUrl: JPEG,
  size: "1024x1536",
  correctedPose: {
    description: "Private target description",
    joint_targets: [{ angle_key: "elbow_top", target_deg: 60 }],
  },
  primaryFault: "Private fault description",
};
const scanResult = (provider: "cosmos" | "gpt-fallback") => ({
  provider,
  model: "test-model",
  raw: "Private model response",
  events: [
    {
      t_start: 1,
      t_peak: 2,
      t_end: 3,
      issue: "knee_kick",
      body_part: "knees",
      severity: 3,
      confidence: 0.8,
      description: "Private scan detail",
    },
  ],
});
const provider = (id: ScanProvider["id"], run: ScanProvider["run"]): ScanProvider => ({
  id,
  configured: () => true,
  model: () => "test-model",
  run,
});
const exported = () => mocks.exportTrace.mock.calls.map(([event]) => event);

describe("sponsor telemetry wiring", () => {
  beforeEach(() => {
    setEnv({
      WEAVE_ENABLED: "1",
      WEAVE_PROJECT: "fixtures/telemetry",
      WANDB_API_KEY: "fixture-wandb-secret",
    });
    mocks.exportTrace.mockReset().mockResolvedValue({ status: "sent" });
    mocks.coach.mockReset();
    mocks.correct.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network call in telemetry wiring test");
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setEnv();
  });

  it("records real scan attempts and maps GPT fallback without exporting request content", async () => {
    const skipped = vi.fn();
    const result = await runScanChain(scanBody(), undefined, [
      provider("cosmos", async () => {
        throw Object.assign(new Error("private upstream error"), {
          status: 429,
        });
      }),
      provider("gpt-fallback", async () => scanResult("gpt-fallback")),
      { ...provider("nemotron", skipped), configured: () => false },
    ]);
    expect(result.provider).toBe("gpt-fallback");
    expect(skipped).not.toHaveBeenCalled();
    expect(exported()).toEqual([
      {
        operation: "scan",
        provider: "cosmos",
        model: "test-model",
        mode: "live",
        durationMs: expect.any(Number),
        outcome: "error",
        errorCategory: "rate_limit",
      },
      {
        operation: "scan",
        provider: "openai",
        model: "test-model",
        mode: "live",
        durationMs: expect.any(Number),
        outcome: "fallback",
      },
    ]);
    expect(JSON.stringify(exported())).not.toMatch(/Private|private|data:image|frames|keypoints/);
  });

  it("starts the next provider while the preceding trace is still exporting", async () => {
    let finishExport!: (value: { status: string }) => void;
    mocks.exportTrace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishExport = resolve;
        }),
    );
    const fallback = vi.fn(async () => scanResult("gpt-fallback"));
    const pending = runScanChain(scanBody(), undefined, [
      provider("cosmos", async () => {
        throw new TimeoutError(1);
      }),
      provider("gpt-fallback", fallback),
    ]);
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledOnce());
    finishExport({ status: "sent" });
    expect((await pending).provider).toBe("gpt-fallback");
  });

  it("preserves scan failure traces when the exporter rejects", async () => {
    mocks.exportTrace.mockRejectedValue(new Error("exporter unavailable"));
    const failed = runScanChain(scanBody(), undefined, [
      provider("cosmos", async () => {
        throw new TimeoutError(1);
      }),
    ]);
    await expect(failed).rejects.toMatchObject({
      name: "ScanChainError",
      trace: [expect.objectContaining({ provider: "cosmos", ok: false })],
    });
    expect(exported()[0]).toMatchObject({
      outcome: "error",
      errorCategory: "timeout",
    });
  });

  it("records coach completion after the streamed report while exporter failure leaves done intact", async () => {
    mocks.exportTrace.mockRejectedValue(new Error("exporter unavailable"));
    mocks.coach.mockImplementation(async (_body, options) => {
      options.onDelta("Private streamed text");
      return COACH_REPORT;
    });
    const response = await coach(post("/api/coach", coachBody()));
    expect(response.status).toBe(200);
    expect((await readEvents(response)).map((event) => event.event)).toEqual(["delta", "done"]);
    expect(exported()).toEqual([
      {
        operation: "coach",
        provider: "openai",
        model: "gpt-6.1-sol",
        mode: "live",
        durationMs: expect.any(Number),
        outcome: "success",
      },
    ]);
  });

  it("records a coach stream error rather than reporting HTTP 200 as success", async () => {
    mocks.coach.mockRejectedValue(new SyntaxError("Private malformed response"));
    const response = await coach(post("/api/coach", coachBody()));
    expect(response.status).toBe(200);
    expect((await readEvents(response)).at(-1)?.event).toBe("error");
    expect(exported()[0]).toMatchObject({
      operation: "coach",
      outcome: "error",
      errorCategory: "invalid_response",
    });
    expect(JSON.stringify(exported())).not.toContain("Private malformed response");
  });

  it("preserves correction success and timeout mapping with metadata-only events", async () => {
    const result = {
      imageDataUrl: JPEG,
      model: "test-image",
      ms: 12,
      prompt: "Private image prompt",
    };
    mocks.correct.mockResolvedValueOnce(result);
    expect(await (await correct(post("/api/correct", correction))).json()).toEqual(result);
    expect(exported()[0]).toEqual({
      operation: "correct",
      provider: "openai",
      model: "test-image",
      mode: "live",
      durationMs: expect.any(Number),
      outcome: "success",
    });
    mocks.correct.mockRejectedValueOnce(new TimeoutError(10));
    const response = await correct(post("/api/correct", correction));
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("timeout");
    expect(exported()[1]).toMatchObject({
      operation: "correct",
      outcome: "error",
      errorCategory: "timeout",
    });
    expect(JSON.stringify(exported())).not.toMatch(/Private|data:image/);
  });

  it("does not export cached route fixtures even when Weave is enabled", async () => {
    setEnv({
      MOCK_AI: "1",
      WEAVE_ENABLED: "1",
      WEAVE_PROJECT: "fixtures/telemetry",
      WANDB_API_KEY: "fixture-wandb-secret",
    });
    expect((await scan(post("/api/scan", scanBody()))).status).toBe(200);
    expect((await readEvents(await coach(post("/api/coach", coachBody())))).at(-1)?.event).toBe("done");
    expect((await correct(post("/api/correct", correction))).status).toBe(200);
    expect(mocks.exportTrace).not.toHaveBeenCalled();
    expect(mocks.coach).not.toHaveBeenCalled();
    expect(mocks.correct).not.toHaveBeenCalled();
  });

  it("exposes only safe Weave configuration status and exports nothing for health probes", async () => {
    setEnv({
      COSMOS_BASE_URL: undefined,
      NVIDIA_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      WEAVE_ENABLED: "1",
      WEAVE_PROJECT: "private-team/private-project",
      WANDB_API_KEY: "fixture-wandb-secret",
    });
    const response = await health(new Request("http://x/api/health?probe=1"));
    const text = await response.text();
    expect(JSON.parse(text).weave).toEqual({ enabled: true, configured: true });
    expect(text).not.toMatch(/private-team|private-project|fixture-wandb-secret|trace.wandb.ai/);
    expect(mocks.exportTrace).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redacts sponsor credentials and Basic authentication from error messages", () => {
    const secrets = {
      WANDB_API_KEY: "private-wandb-token",
      VAST_APP_ACCESS_KEY: "private-library-key",
      VAST_BEARER_TOKEN: "private-vast-token",
      VAST_USERNAME: "gym",
      VAST_PASSWORD: "p@ss",
    };
    setEnv(secrets);
    const text = safeErrorMessage(new Error(Object.values(secrets).join(" ") + " Basic cHJpdmF0ZTpwYXNzd29yZA=="), 1000);
    for (const secret of Object.values(secrets)) expect(text).not.toContain(secret);
    expect(text).not.toContain("cHJpdmF0ZTpwYXNzd29yZA==");
    setEnv();
    for (const key of Object.keys(secrets)) expect(process.env[key]).toBeUndefined();
  });
});
