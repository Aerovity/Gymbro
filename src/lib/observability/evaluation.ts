import { exportSponsorTrace } from "./exporter";
import { classifyTraceError, readWeaveConfig, sanitiseTrace, type SponsorTrace } from "./trace";

type EvaluationCase = { id: string; passed: boolean };
export type SponsorPolicyEvaluation = {
  scope: "synthetic-contract-policy";
  videoAccuracyMeasured: false;
  providerInferencePerformed: false;
  cases: EvaluationCase[];
  passed: number;
  total: number;
};

/** Runs against an in-memory transport; it never calls a model or trace service. */
export async function evaluateSponsorPolicies(): Promise<SponsorPolicyEvaluation> {
  const event: SponsorTrace = { operation: "scan", provider: "cosmos", model: "contract-fixture", mode: "synthetic", durationMs: 12, outcome: "success" };
  const cases: EvaluationCase[] = [];
  const check = async (id: string, run: () => boolean | Promise<boolean>) => {
    try { cases.push({ id, passed: await run() }); }
    catch { cases.push({ id, passed: false }); }
  };
  const config = readWeaveConfig({ WEAVE_ENABLED: "1", WEAVE_PROJECT: "fixtures/gymbro", WANDB_API_KEY: "fixture-only-key" });
  await check("disabled-makes-no-network-request", async () => {
    let calls = 0;
    const result = await exportSponsorTrace(event, readWeaveConfig({}), async () => { calls++; return new Response(); });
    return result.status === "disabled" && calls === 0;
  });
  await check("content-never-enters-trace-body", async () => {
    const bodies: string[] = [];
    const input = { ...event, prompt: "PRIVATE_PROMPT", frames: ["PRIVATE_IMAGE"], error: "PRIVATE_ERROR" };
    const result = await exportSponsorTrace(input, config, async (_url, init) => {
      bodies.push(String(init?.body)); return new Response();
    });
    const payload = bodies.join("");
    return result.status === "sent" && bodies.length === 2 && !payload.includes("PRIVATE_") && !payload.includes("fixture-only-key");
  });
  await check("provider-failure-does-not-escape-export", async () => {
    const result = await exportSponsorTrace(event, config, async () => { throw new Error("PRIVATE_ERROR"); });
    return result.status === "failed" && result.reason === "network";
  });
  await check("insecure-endpoint-is-not-configured", () => !readWeaveConfig({ WEAVE_TRACE_BASE_URL: "http://example.test" }).baseUrl);
  await check("mock-and-live-labels-stay-distinct", () =>
    sanitiseTrace({ ...event, mode: "mock" })?.mode === "mock" && sanitiseTrace({ ...event, mode: "live" })?.mode === "live");
  await check("rate-limit-has-bounded-category", () => classifyTraceError({ status: 429, message: "PRIVATE_ERROR" }) === "rate_limit");
  await check("invalid-duration-is-rejected", () => sanitiseTrace({ ...event, durationMs: Number.NaN }) === null);
  await check("fallback-remains-visible", () => sanitiseTrace({ ...event, outcome: "fallback" })?.outcome === "fallback");
  return { scope: "synthetic-contract-policy", videoAccuracyMeasured: false, providerInferencePerformed: false,
    cases, passed: cases.filter((item) => item.passed).length, total: cases.length };
}
