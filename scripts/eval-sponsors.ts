import { evaluateSponsorPolicies } from "../src/lib/observability/evaluation";
import { exportSponsorTrace } from "../src/lib/observability/exporter";
import { readWeaveConfig } from "../src/lib/observability/trace";

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--export")) {
    console.error("Usage: tsx scripts/eval-sponsors.ts [--export]");
    process.exitCode = 1;
    return;
  }
  const start = Date.now();
  const result = await evaluateSponsorPolicies();
  // A separate CLI opt-in prevents an evaluation from exporting just because app tracing is enabled.
  const trace = process.argv.includes("--export")
    ? await exportSponsorTrace({ operation: "evaluation", provider: "local", model: "contract-policy-v1",
      mode: "synthetic", durationMs: Date.now() - start, outcome: result.passed === result.total ? "success" : "error",
      evaluation: { passed: result.passed, total: result.total } }, readWeaveConfig(process.env))
    : { status: "not_requested" };
  console.log(JSON.stringify({ ...result, traceExport: trace }, null, 2));
  if (result.passed !== result.total || (process.argv.includes("--export") && trace.status !== "sent")) process.exitCode = 1;
}

main().catch(() => { console.error("Synthetic policy evaluation could not complete."); process.exitCode = 1; });
