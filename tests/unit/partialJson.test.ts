import { describe, expect, it } from "vitest";
import { extractPartialString } from "@/lib/api/partialJson";

const K = "spoken_summary";

describe("extractPartialString", () => {
  it("returns empty string before the key or its value appears", () => {
    expect(extractPartialString("", K)).toBe("");
    expect(extractPartialString("{", K)).toBe("");
    expect(extractPartialString('{"spoken_su', K)).toBe("");
    expect(extractPartialString('{"spoken_summary"', K)).toBe("");
    expect(extractPartialString('{"spoken_summary": ', K)).toBe("");
    expect(extractPartialString('{"spoken_summary": "', K)).toBe("");
  });

  it("returns the growing value of an incomplete string", () => {
    expect(extractPartialString('{"spoken_summary":"Nice pu', K)).toBe("Nice pu");
    expect(extractPartialString('{ "spoken_summary" :\n "Nice pull', K)).toBe("Nice pull");
  });

  it("returns the full value once closed, ignoring what follows", () => {
    expect(extractPartialString('{"spoken_summary":"Done.","headline":"X"}', K)).toBe("Done.");
  });

  it("decodes escapes", () => {
    const full = JSON.stringify({ spoken_summary: 'He said "go"\\ now\nnext\ttab / 60° é 💪' });
    expect(extractPartialString(full, K)).toBe('He said "go"\\ now\nnext\ttab / 60° é 💪');
    expect(extractPartialString('{"spoken_summary":"a\\u00b0b', K)).toBe("a°b");
  });

  it("stops cleanly at incomplete escapes", () => {
    expect(extractPartialString('{"spoken_summary":"a\\', K)).toBe("a");
    expect(extractPartialString('{"spoken_summary":"a\\u00', K)).toBe("a");
    expect(extractPartialString('{"spoken_summary":"a\\ud83d', K)).toBe("a"); // lone high surrogate dropped
    expect(extractPartialString('{"spoken_summary":"a\\ud83d\\udcaa', K)).toBe("a💪");
  });

  it("matches keys only, not identical text inside other values", () => {
    const s = '{"headline":"spoken_summary","note":"\\"spoken_summary\\": \\"fake","spoken_summary":"real';
    expect(extractPartialString(s, K)).toBe("real");
  });

  it("is consistent across every prefix of a real document", () => {
    const summary = 'Elbows at 88° — "pull" to 60°.\nGo!';
    const full = JSON.stringify({ spoken_summary: summary, headline: "H", cues: ["a"] });
    let prev = "";
    for (let i = 0; i <= full.length; i++) {
      const v = extractPartialString(full.slice(0, i), K);
      expect(summary.startsWith(v)).toBe(true);
      expect(v.length).toBeGreaterThanOrEqual(prev.length);
      prev = v;
    }
    expect(prev).toBe(summary);
  });

  it("returns empty for non-string values", () => {
    expect(extractPartialString('{"spoken_summary":null}', K)).toBe("");
    expect(extractPartialString('{"spoken_summary":12', K)).toBe("");
  });
});
