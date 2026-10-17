import { describe, expect, it } from "vitest";
import {
  ScanParseError,
  extractJson,
  findBalanced,
  mapExercise,
  mapView,
  parseScanOutput,
  parseTimestamp,
  stripThink,
} from "@/lib/providers/parseJson";
import { ScanModelOutputSchema } from "@/lib/schemas";

const good = {
  exercise: "pull_up",
  view: "front",
  rep_count: 6,
  events: [
    {
      t_start: 6.75,
      t_peak: 7.0,
      t_end: 7.5,
      rep_index: 3,
      issue: "partial_range_top",
      body_part: "arms",
      severity: 4,
      confidence: 0.8,
      description: "Chin stays below the bar.",
    },
  ],
  overall: "Partial reps with a leg kick.",
};

describe("stripThink / extractJson", () => {
  it("strips <think> blocks", () => {
    const t = `<think>The user wants {json}. Let me think [a]...</think>\n${JSON.stringify(good)}`;
    expect(stripThink(t)).toBe(JSON.stringify(good));
    expect(extractJson(t)).toEqual(good);
  });
  it("handles a dangling </think> and an unterminated <think>", () => {
    expect(stripThink("reasoning {x} </think> {\"a\":1}")).toBe('{"a":1}');
    expect(extractJson('<think>hmm still thinking {"a": 1}')).toEqual({ a: 1 });
    expect(stripThink("<think>nothing here")).toBe("");
  });
  it("handles ```json fences and trailing prose", () => {
    const t = "Here you go:\n```json\n" + JSON.stringify(good, null, 2) + "\n```\nHope this helps! {not json}";
    expect(extractJson(t)).toEqual(good);
    expect(extractJson('Sure! {"a": {"b": "}"}} trailing } prose')).toEqual({ a: { b: "}" } });
  });
  it("finds the first balanced array, with escapes in strings", () => {
    expect(extractJson('result: [{"q": "say \\"hi\\" ]"}] done')).toEqual([{ q: 'say "hi" ]' }]);
    expect(findBalanced("{ [ } ] {\"ok\":true}")).toBe('{"ok":true}');
    expect(findBalanced("no json here")).toBeNull();
  });
  it("repairs trailing commas", () => {
    expect(extractJson('{"events": [1, 2,],}')).toEqual({ events: [1, 2] });
  });
  it("throws ScanParseError when nothing parses", () => {
    expect(() => extractJson("no json at all")).toThrow(ScanParseError);
    expect(() => extractJson("{bad: json}")).toThrow(ScanParseError);
    try {
      extractJson("nope");
    } catch (e) {
      expect((e as ScanParseError).raw).toBe("nope");
      expect((e as Error).name).toBe("ScanParseError");
    }
  });
});

describe("parseTimestamp", () => {
  it.each<[unknown, number | null]>([
    [7.2, 7.2],
    ["7.2", 7.2],
    ["7.2s", 7.2],
    ["7 sec", 7],
    ["7 seconds", 7],
    ["0:07", 7],
    ["1:02.5", 62.5],
    ["00:00:07.5", 7.5],
    ["t=7.25s", 7.25],
    ["t = 3s", 3],
    ["@4.5s", 4.5],
    ["500ms", 0.5],
    [".5", 0.5],
    ["soon", null],
    [null, null],
    [Infinity, null],
    [{}, null],
  ])("%s → %s", (v, out) => {
    const r = parseTimestamp(v);
    if (out === null) expect(r).toBeNull();
    else expect(r).toBeCloseTo(out, 9);
  });
});

describe("mapExercise / mapView", () => {
  it.each([
    ["pullup", "pull_up"],
    ["Pull-Up", "pull_up"],
    ["chin-up", "pull_up"],
    ["bench", "bench_press"],
    ["Barbell Back Squat", "squat"],
    ["RDL", "deadlift"],
    ["OHP", "overhead_press"],
    ["military press", "overhead_press"],
    ["bicep curls", "biceps_curl"],
    ["squat", "squat"],
  ])("%s → %s", (i, o) => expect(mapExercise(i)).toBe(o));
  it("unknowns", () => {
    expect(mapExercise("yoga")).toBeUndefined();
    expect(mapExercise(3)).toBeUndefined();
  });
  it("views", () => {
    expect(mapView("rear")).toBe("front");
    expect(mapView("from behind")).toBe("front");
    expect(mapView("Side")).toBe("side");
    expect(mapView("45 degree")).toBe("angled");
    expect(mapView("???")).toBe("unknown");
    expect(mapView(undefined)).toBeUndefined();
  });
});

describe("parseScanOutput", () => {
  it("parses a clean response and validates against the schema", () => {
    const out = parseScanOutput(JSON.stringify(good), { duration: 15 });
    expect(ScanModelOutputSchema.parse(out)).toEqual(out);
    expect(out.exercise).toBe("pull_up");
    expect(out.events[0].t_peak).toBe(7);
    expect(out.rep_count).toBe(6);
  });
  it("coerces string timestamps, clamps out-of-range and snaps to frame times", () => {
    const text = JSON.stringify({
      exercise: "pullup",
      view: "rear",
      events: [
        { t_start: "0:06", t_peak: "7.2s", t_end: "00:00:07.9", issue: "kip", body_part: "legs", severity: "high", confidence: "80%", description: "x" },
        { t_peak: 99, issue: "late", body_part: "arms", severity: 9, confidence: 3 },
        { t_peak: -4, t_start: 2, t_end: -1, issue: "early", body_part: "arms", severity: 0, confidence: -1 },
      ],
    });
    const frameTimes = [0, 0.25, 6, 7, 7.25, 7.75, 8, 14.75];
    const out = parseScanOutput(text, { duration: 15, frameTimes });
    expect(out.exercise).toBe("pull_up");
    expect(out.view).toBe("front");
    const [a, b, c] = out.events;
    expect(a).toMatchObject({ t_start: 6, t_peak: 7.25, t_end: 8, severity: 4, confidence: 0.8 });
    expect(b.t_peak).toBe(14.75); // clamped to 15 then snapped
    expect(b.severity).toBe(5);
    expect(b.confidence).toBeCloseTo(0.03, 9); // 3 → read as percent
    expect(c.t_peak).toBe(0);
    expect(c.t_start).toBeLessThanOrEqual(c.t_peak);
    expect(c.t_end).toBeGreaterThanOrEqual(c.t_peak);
    expect(c.severity).toBe(1);
    expect(c.confidence).toBe(0);
    for (const e of out.events) {
      expect(e.t_start).toBeLessThanOrEqual(e.t_peak);
      expect(e.t_peak).toBeLessThanOrEqual(e.t_end);
      expect(e.t_end).toBeLessThanOrEqual(15);
    }
  });
  it("fills defaults and alternative keys; drops events without a time", () => {
    const text = JSON.stringify({
      faults: [
        { timestamp: "t=3.5s", fault: "x", severity: "4/5" },
        { start: 2, end: 4, type: "knee_cave", part: "knees", rep: 2.2, confidence: "high", details: "d" },
        { issue: "no time" },
        "garbage",
      ],
      reps: "5",
    });
    const out = parseScanOutput(text, { duration: 10 });
    expect(out.events).toHaveLength(2);
    expect(out.events[0]).toMatchObject({ t_peak: 3.5, t_start: 3, t_end: 4, issue: "technique_fault", body_part: "body", severity: 4, confidence: 0.5 });
    expect(out.events[1]).toMatchObject({ t_peak: 3, issue: "knee_cave", body_part: "knees", rep_index: 2, confidence: 0.85, description: "d" });
    expect(out.rep_count).toBe(5);
  });
  it("accepts a bare array and an empty clean set", () => {
    expect(parseScanOutput('[{"t_peak": 2, "issue": "ok_issue"}]', { duration: 5 }).events).toHaveLength(1);
    const clean = parseScanOutput('```json\n{"exercise":"bench","events":[],"overall":"Clean set."}\n```', { duration: 5 });
    expect(clean.events).toEqual([]);
    expect(clean.exercise).toBe("bench_press");
  });
  it("caps at 8 events and truncates long strings", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ t_peak: i, issue: "x".repeat(100), body_part: "y".repeat(50), description: "z".repeat(500) }));
    const out = parseScanOutput(JSON.stringify({ events, overall: "o".repeat(600) }), { duration: 20 });
    expect(out.events).toHaveLength(8);
    expect(out.events[0].issue).toHaveLength(60);
    expect(out.events[0].body_part).toHaveLength(30);
    expect(out.events[0].description).toHaveLength(300);
    expect(out.overall).toHaveLength(400);
  });
  it("handles a think block + prose wrapped response end-to-end", () => {
    const text = `<think>Rep 3 looks short.</think>\nHere is the analysis:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\nLet me know!`;
    expect(parseScanOutput(text, { duration: 15 }).events[0].issue).toBe("partial_range_top");
  });
  it("throws ScanParseError on unusable output", () => {
    expect(() => parseScanOutput("I could not analyse this video.", { duration: 5 })).toThrow(ScanParseError);
    expect(() => parseScanOutput('{"events": "none"}', { duration: 5 })).toThrow(ScanParseError);
    expect(() => parseScanOutput('{"foo": 1}', { duration: 5 })).toThrow(ScanParseError);
    expect(() => parseScanOutput("[1, 2]", { duration: 5 })).not.toThrow();
  });
  it("tolerates a bad duration", () => {
    expect(parseScanOutput('{"events":[{"t_peak":3,"issue":"ab"}]}', { duration: NaN }).events[0].t_peak).toBe(3);
  });
});
