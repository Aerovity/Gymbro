import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as status } from "@/app/api/vast/status/route";
import { POST as search } from "@/app/api/vast/search/route";
import { GET as clip } from "@/app/api/vast/clip/route";
import { MAX_CLIP_BYTES } from "@/lib/vast/client";

const accessKey = "unit-test-team-access-key-32-characters";
const token = "unit-test-provider-token";
const source = "s3://vss-chunks-segments/athlete/squat-01.mp4";
const fixture = {
  results: [{ source, similarity_score: 0.91, reasoning_content: "The squat becomes shallow in the last repetition." }],
  chunk_results: [{ original_video: "s3://vss-chunks/set.mp4", preview_source: source, best_match_start_sec: 12, best_match_end_sec: 17 }],
  sql_query: "private SQL must not be returned", llm_synthesis: { response: "unrequested synthesis" },
};
let sequence = 0;
function configure(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ VAST_ENABLED: "1", VAST_BASE_URL: "https://vss.example.test", VAST_WORKOUT_TAG: "permitted-gym-clips", VAST_APP_ACCESS_KEY: accessKey, VAST_BEARER_TOKEN: token, VAST_USERNAME: `test-user-${++sequence}`, VAST_PASSWORD: "test-password", VAST_ALLOW_HTTP: "", ...overrides })) vi.stubEnv(key, value);
}
function searchRequest(body: unknown = { query: "squat depth", limit: 5 }, key = accessKey) {
  return new Request("http://localhost/api/vast/search", { method: "POST", headers: { "x-vast-access-key": key }, body: JSON.stringify(body) });
}
async function playbackUrl() {
  const response = await search(searchRequest());
  expect(response.status).toBe(200);
  return (await response.json()).results[0].playbackUrl as string;
}

describe("VAST retrieval routes", () => {
  beforeEach(() => configure());
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("reports configuration without a remote probe and never treats fixtures as VAST", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    configure({ VAST_ENABLED: "", MOCK_AI: "1", DEMO_MODE: "1" });
    const response = status();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: "vast", enabled: false, configured: false });
    expect((await search(searchRequest())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { VAST_WORKOUT_TAG: "" }, { VAST_APP_ACCESS_KEY: "short" },
    { VAST_BEARER_TOKEN: "", VAST_PASSWORD: "" },
    { VAST_BASE_URL: "http://vss.example.test" },
    { VAST_BASE_URL: "https://token@vss.example.test" },
    { VAST_BASE_URL: "https://vss.example.test?token=secret" },
    { VAST_BASE_URL: "file:///private/data" },
  ])("requires an explicit valid configuration: %j", async (invalid) => {
    configure(invalid); expect((await status().json()).configured).toBe(false);
  });

  it("permits explicitly configured HTTP workshop ingress", () => {
    configure({ VAST_BASE_URL: "http://private-vss.test", VAST_ALLOW_HTTP: "1" });
    expect(status().status).toBe(200);
  });

  it.each(["", "wrong-key"])("rejects a missing or incorrect team key before any provider call", async (key) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await search(searchRequest(undefined, key));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("vast_access_required");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the documented VSS request and maps bounded evidence without returning credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))); vi.stubGlobal("fetch", fetch);
    const response = await search(searchRequest({ query: " squat depth ", limit: 3 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    for (const secret of [token, accessKey, "test-password", "sql_query", "llm_synthesis", source]) expect(text).not.toContain(secret);
    const result = JSON.parse(text);
    expect(result).toMatchObject({ provider: "vast", results: [{ title: "squat-01.mp4", similarity: 0.91, startSeconds: 12, endSeconds: 17 }] });
    expect(result.results[0].playbackUrl).toMatch(/^\/api\/vast\/clip\?ticket=/);
    const opaqueTicket = new URL(result.results[0].playbackUrl, "http://localhost").searchParams.get("ticket")!;
    expect(Buffer.from(opaqueTicket.split(".")[0], "base64url").toString()).not.toContain(source);
    expect(String(fetch.mock.calls[0][0])).toBe("https://vss.example.test/api/v1/search");
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ query: "squat depth", top_k: 3, llm_top_n: 1, min_similarity: 0.3, tags: ["permitted-gym-clips"], time_filter: "all", include_public: false });
  });

  it("returns a genuine empty result set without a fabricated fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"results":[]}')));
    const response = await search(searchRequest());
    expect(response.status).toBe(200); expect((await response.json()).results).toEqual([]);
  });

  it.each([{ query: "a" }, { query: "x".repeat(501) }, { query: "squat", limit: 11 }, { query: "squat", upstreamUrl: "https://evil.test" }])("rejects malformed search requests", async (body) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await search(searchRequest(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds request bodies before decoding JSON", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await search(searchRequest({ query: "x".repeat(5000) }));
    expect(response.status).toBe(413);
  });

  it.each([
    "not JSON", JSON.stringify({ results: [{ source: "https://evil.test/clip", similarity_score: 0.9 }] }),
    JSON.stringify({ results: [{ source, similarity_score: "0.9" }] }),
  ])("rejects malformed upstream data", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const response = await search(searchRequest());
    expect(response.status).toBe(502); expect((await response.json()).error.code).toBe("vast_invalid_response");
  });

  it("bounds upstream JSON even without a content length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(" ".repeat(512 * 1024 + 1))));
    const response = await search(searchRequest());
    expect(response.status).toBe(502); expect((await response.json()).error.code).toBe("vast_response_too_large");
  });

  it("sanitises provider failures and prevents redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(`bad secret ${token}`, { status: 302, headers: { Location: "https://other.test" } })); vi.stubGlobal("fetch", fetch);
    const response = await search(searchRequest());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain(token);
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });

  it("logs in server-side and refreshes once on an expired token", async () => {
    configure({ VAST_BEARER_TOKEN: "" });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"access_token":"first-token","token_type":"bearer"}'))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"access_token":"second-token","token_type":"bearer"}'))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetch);
    const response = await search(searchRequest());
    expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain("first-token"); expect(text).not.toContain("second-token");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(fetch.mock.calls[0][0])).toBe("https://vss.example.test/api/v1/auth/login");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ password: "test-password" });
    expect(fetch.mock.calls[3][1].headers.Authorization).toBe("Bearer second-token");
  });

  it("does not attempt to log in when a configured bearer token is rejected", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(token, { status: 401 })); vi.stubGlobal("fetch", fetch);
    const response = await search(searchRequest());
    expect(response.status).toBe(502); expect((await response.json()).error.code).toBe("vast_auth_failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("proxies a signed video range, keeping the provider token server-side", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture)))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2, 3]), { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-3/100" } }));
    vi.stubGlobal("fetch", fetch);
    const url = await playbackUrl();
    const response = await clip(new Request(`http://localhost${url}`, { headers: { Range: "bytes=0-3" } }));
    expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 0-3/100");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3]));
    const upstream = new URL(String(fetch.mock.calls[1][0]));
    expect(upstream.pathname).toBe("/api/v1/videos/stream"); expect(upstream.searchParams.get("source")).toBe(source); expect(upstream.searchParams.get("token")).toBe(token);
    expect(fetch.mock.calls[1][1]).toMatchObject({ redirect: "error", headers: { Range: "bytes=0-3" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect([...response.headers.values()].join()).not.toContain(token);
  });

  it("rejects arbitrary sources and altered or expired tickets without calling VAST", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))); vi.stubGlobal("fetch", fetch);
    const url = await playbackUrl(); fetch.mockClear();
    expect((await clip(new Request("http://localhost/api/vast/clip?source=https://evil.test"))).status).toBe(400);
    expect((await clip(new Request(`http://localhost${url}x`))).status).toBe(400);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60_000);
    expect((await clip(new Request(`http://localhost${url}`))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates playback tickets when the team key or dataset changes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))); vi.stubGlobal("fetch", fetch);
    const url = await playbackUrl(); fetch.mockClear();
    configure({ VAST_APP_ACCESS_KEY: "new-team-access-key-with-at-least-32-characters" });
    expect((await clip(new Request(`http://localhost${url}`))).status).toBe(400);
    configure({ VAST_WORKOUT_TAG: "another-private-dataset" });
    expect((await clip(new Request(`http://localhost${url}`))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a safe timeout error for a cancelled upstream request", async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`cancelled ${token}`)));
    const request = new Request("http://localhost/api/vast/search", { method: "POST", headers: { "x-vast-access-key": accessKey }, body: JSON.stringify({ query: "squat depth" }), signal: controller.signal });
    const response = await search(request);
    expect(response.status).toBe(504); expect(await response.text()).not.toContain(token);
  });

  it.each(["bytes=0-1,4-5", "bytes=-0", "bytes=20-10", "bytes=9007199254740993-"])("rejects an unsupported range: %s", async (range) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))); vi.stubGlobal("fetch", fetch);
    const url = await playbackUrl(); fetch.mockClear();
    expect((await clip(new Request(`http://localhost${url}`, { headers: { Range: range } }))).status).toBe(416);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clamps large browser ranges and supports bounded suffix ranges", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture)))
      .mockResolvedValueOnce(new Response("1234", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-3/100" } }))
      .mockResolvedValueOnce(new Response("5678", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 96-99/100" } }));
    vi.stubGlobal("fetch", fetch); const url = await playbackUrl();
    expect((await clip(new Request(`http://localhost${url}`, { headers: { Range: "bytes=0-99999999" } }))).status).toBe(206);
    expect(fetch.mock.calls[1][1].headers.Range).toBe(`bytes=0-${MAX_CLIP_BYTES - 1}`);
    expect((await clip(new Request(`http://localhost${url}`, { headers: { Range: "bytes=-4" } }))).status).toBe(206);
    expect(fetch.mock.calls[2][1].headers.Range).toBe("bytes=-4");
  });

  it("rejects malformed video ranges and oversized video responses", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture)))
      .mockResolvedValueOnce(new Response("1234", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 10-13/20" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(MAX_CLIP_BYTES + 1), { headers: { "Content-Type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetch); const url = await playbackUrl();
    const invalid = await clip(new Request(`http://localhost${url}`)); expect(invalid.status).toBe(502);
    const tooLarge = await clip(new Request(`http://localhost${url}`)); expect(tooLarge.status).toBe(502);
    expect((await tooLarge.json()).error.code).toBe("vast_response_too_large");
  });
});
