import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, createSseParser, postScan, readSse, streamCoach, type SseMessage } from "@/lib/api/client";
import type { CoachReport, CoachRequest } from "@/lib/schemas";

const collect = (chunks: string[]) => {
  const out: SseMessage[] = [];
  const p = createSseParser((m) => out.push(m));
  for (const c of chunks) p.push(c);
  p.end();
  return out;
};

const bodyOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });

const REPORT: CoachReport = {
  spoken_summary: "Pull higher.",
  headline: "PULL HIGHER",
  primary_fault: { id: "x", title: "t", explanation: "e", body_part: "elbows", severity: 3 },
  secondary_faults: [],
  angle_feedback: [],
  cues: ["Elbows down."],
  drill: { name: "n", prescription: "p", why: "w" },
  corrected_pose: { description: "d", joint_targets: [] },
  safety_note: null,
  form_score_adjustment: 0,
};

describe("createSseParser", () => {
  it("parses multiple events in one chunk", () => {
    const out = collect(['event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\nevent: done\ndata: {}\n\n']);
    expect(out).toEqual([
      { event: "delta", data: '{"text":"a"}' },
      { event: "delta", data: '{"text":"b"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("handles arbitrary chunk boundaries, including one char at a time", () => {
    const stream = 'event: delta\ndata: {"text":"hello"}\n\nevent: done\ndata: {"ok":true}\n\n';
    const one = collect(stream.split(""));
    expect(one).toEqual(collect([stream]));
    expect(collect(["event: del", "ta\nda", 'ta: {"text":"x"}\n', "\n"])).toEqual([{ event: "delta", data: '{"text":"x"}' }]);
  });

  it("handles CRLF (split across chunks), comments, multi-line data and a missing final blank line", () => {
    const out = collect([": keep-alive\r", "\nevent: a\r\ndata: line1\r\ndata: line2\r\n\r\n", "data: tail"]);
    expect(out).toEqual([
      { event: "a", data: "line1\nline2" },
      { event: "message", data: "tail" },
    ]);
  });

  it("readSse decodes UTF-8 split across byte chunks", async () => {
    const bytes = new TextEncoder().encode('event: delta\ndata: {"text":"60° 💪"}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        c.close();
      },
    });
    const out: SseMessage[] = [];
    await readSse(body, (m) => out.push(m));
    expect(JSON.parse(out[0].data).text).toBe("60° 💪");
  });
});

describe("streamCoach / API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  const sseResponse = (chunks: string[]) =>
    new Response(bodyOf(chunks), { headers: { "Content-Type": "text/event-stream" } });

  it("calls onDelta(full, summarySoFar) and resolves with the done report", async () => {
    const full = JSON.stringify(REPORT);
    const parts = [full.slice(0, 10), full.slice(10, 25), full.slice(25)];
    const sse = parts.map((t) => `event: delta\ndata: ${JSON.stringify({ text: t })}\n\n`).join("") +
      `event: done\ndata: ${JSON.stringify(REPORT)}\n\n`;
    // deliberately split the SSE text at odd places
    const fetchMock = vi.fn(async () => sseResponse([sse.slice(0, 7), sse.slice(7, 61), sse.slice(61)]));
    vi.stubGlobal("fetch", fetchMock);
    const seen: [string, string][] = [];
    const report = await streamCoach({} as CoachRequest, { onDelta: (f, s) => seen.push([f, s]) });
    expect(report).toEqual(REPORT);
    expect(seen.map((s) => s[0])).toEqual([parts[0], parts[0] + parts[1], full]);
    expect(seen.at(-1)?.[1]).toBe("Pull higher.");
    expect(fetchMock.mock.calls[0]).toMatchObject(["/api/coach", { method: "POST" }]);
  });

  it("rejects with ApiClientError on an error event", async () => {
    vi.stubGlobal("fetch", async () => sseResponse(['event: error\ndata: {"message":"model down"}\n\n']));
    const err = await streamCoach({} as CoachRequest).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.message).toBe("model down");
  });

  it("rejects when the stream ends without done", async () => {
    vi.stubGlobal("fetch", async () => sseResponse(['event: delta\ndata: {"text":"{"}\n\n']));
    await expect(streamCoach({} as CoachRequest)).rejects.toBeInstanceOf(ApiClientError);
  });

  it("maps JSON error envelopes (status, code, trace)", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { code: "scan_failed", message: "All failed" }, trace: [{ step: "scan", ok: false, ms: 1 }] }), {
          status: 502,
        }),
    );
    const err = await postScan({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 502, code: "scan_failed", message: "All failed" });
    expect(err.trace).toHaveLength(1);
  });

  it("maps network failures to code 'network'", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(postScan({} as never)).rejects.toMatchObject({ status: 0, code: "network" });
  });
});
