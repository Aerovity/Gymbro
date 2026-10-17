import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachReportSchema } from "@/lib/schemas";
import { COACH_JSON_SCHEMA } from "@/lib/prompts/coach";
import { COACH_REPORT, coachBody, deltaEvents, fakeStream, post, readEvents, setEnv } from "./helpers";

const openai = vi.hoisted(() => ({ responses: { create: vi.fn() } }));
vi.mock("@/lib/providers/openaiClient", () => ({ getOpenAI: () => openai, resetOpenAI: () => undefined }));

const { POST } = await import("@/app/api/coach/route");
const { streamCoach } = await import("@/lib/api/client");

describe("POST /api/coach", () => {
  beforeEach(() => {
    setEnv();
    openai.responses.create.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("streams delta events then a valid done", async () => {
    const text = JSON.stringify(COACH_REPORT);
    openai.responses.create.mockResolvedValue(fakeStream(deltaEvents(text, 25)));
    const res = await POST(post("/api/coach", coachBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const events = await readEvents(res);
    const deltas = events.filter((e) => e.event === "delta");
    expect(deltas.length).toBe(Math.ceil(text.length / 25));
    expect(deltas.map((d) => (d.data as { text: string }).text).join("")).toBe(text);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(CoachReportSchema.parse(done.data)).toEqual(COACH_REPORT);

    const [params, options] = openai.responses.create.mock.calls[0];
    expect(params.stream).toBe(true);
    expect(params.reasoning).toEqual({ effort: "low" });
    expect(params.text.format).toMatchObject({ type: "json_schema", name: "coach_report", strict: true });
    expect(params.text.format.schema).toBe(COACH_JSON_SCHEMA);
    expect(params.input[0].content[0].type).toBe("input_text");
    expect(params.input[0].content[0].text).toContain("elbow_top (Elbow at top): actual 88°");
    expect(params.input[0].content[1]).toMatchObject({ type: "input_image", detail: "high" });
    expect(options.signal).toBeDefined();
  });

  it("invalid JSON from the model → error event", async () => {
    openai.responses.create.mockResolvedValue(fakeStream(deltaEvents('{"spoken_summary":"Hi there", "headline": ')));
    const events = await readEvents(await POST(post("/api/coach", coachBody())));
    expect(events.some((e) => e.event === "delta")).toBe(true);
    const last = events.at(-1)!;
    expect(last.event).toBe("error");
    expect((last.data as { message: string }).message).toMatch(/invalid JSON/i);
  });

  it("stream failure before any text → non-stream fallback", async () => {
    openai.responses.create
      .mockResolvedValueOnce(fakeStream([], { index: 0, error: new Error("socket hang up") }))
      .mockResolvedValueOnce({ output_text: JSON.stringify(COACH_REPORT), error: null });
    const events = await readEvents(await POST(post("/api/coach", coachBody())));
    expect(events.map((e) => e.event)).toEqual(["delta", "done"]);
    expect(events[1].data).toEqual(COACH_REPORT);
    expect(openai.responses.create.mock.calls[1][0].stream).toBe(false);
  });

  it("response.failed event mid-stream → error event", async () => {
    openai.responses.create.mockResolvedValue(
      fakeStream([
        { type: "response.output_text.delta", delta: '{"spoken_summary":"x' },
        { type: "response.failed", response: { error: { message: "server_error" } } },
      ]),
    );
    const events = await readEvents(await POST(post("/api/coach", coachBody())));
    expect(events.at(-1)?.event).toBe("error");
  });

  it("MOCK_AI → streams the fixture as deltas then done", async () => {
    setEnv({ MOCK_AI: "1" });
    const events = await readEvents(await POST(post("/api/coach", coachBody())));
    const deltas = events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThan(3);
    for (const d of deltas.slice(0, -1)) expect((d.data as { text: string }).text).toHaveLength(30);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    const report = CoachReportSchema.parse(done.data);
    expect(JSON.parse(deltas.map((d) => (d.data as { text: string }).text).join(""))).toEqual(report);
    expect(openai.responses.create).not.toHaveBeenCalled();
  });

  it("no OpenAI key → 503 JSON", async () => {
    setEnv({ OPENAI_API_KEY: undefined });
    const res = await POST(post("/api/coach", coachBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("not_configured");
  });

  it("invalid body → 400", async () => {
    const res = await POST(post("/api/coach", { exercise: "pull_up" }));
    expect(res.status).toBe(400);
  });

  it("client streamCoach reports growing spoken_summary and resolves the report", async () => {
    const text = JSON.stringify(COACH_REPORT);
    openai.responses.create.mockResolvedValue(fakeStream(deltaEvents(text, 7)));
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => POST(new Request(`http://x${url}`, init)));
    const summaries: string[] = [];
    const report = await streamCoach(coachBody(), { onDelta: (_full, s) => summaries.push(s) });
    expect(report).toEqual(COACH_REPORT);
    expect(summaries.at(-1)).toBe(COACH_REPORT.spoken_summary);
    for (let i = 1; i < summaries.length; i++) expect(summaries[i].startsWith(summaries[i - 1])).toBe(true);
  });

  it("client streamCoach rejects on an error event", async () => {
    openai.responses.create.mockResolvedValue(fakeStream(deltaEvents("{nope")));
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => POST(new Request(`http://x${url}`, init)));
    await expect(streamCoach(coachBody())).rejects.toMatchObject({ name: "ApiClientError", code: "coach_failed" });
  });
});
