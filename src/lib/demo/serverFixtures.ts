// Server-side demo/mock fixtures: reads public/demo/<id>/* with fs, falls back to built-in defaults.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CoachReportSchema, ScanResultSchema, type CoachReport, type CoachRequest, type ScanRequest } from "@/lib/schemas";
import type { AngleReport, DemoId, ScanResult } from "@/lib/types";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { formScore } from "@/lib/exercises/score";

/** 8×8 dark-grey JPEG (222 bytes), used when a fixture image is missing. */
export const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgUFBcUFxsbGxsbGyAeICEhISAgICAhISEkJCQqKiokJCQhISQkKCgqKi4vLisrKisvLzIyMjw8OTlGRkhWVmf/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AJCAD//Z";
export const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`;

export const DEFAULT_SCAN: ScanResult = {
  provider: "demo",
  model: "fixture",
  exercise: "pull_up",
  view: "front",
  repCount: 6,
  events: [
    {
      t_start: 6.75,
      t_peak: 7.25,
      t_end: 7.75,
      rep_index: 3,
      issue: "partial_range_top",
      body_part: "elbows",
      severity: 4,
      confidence: 0.82,
      description: "Chin stays below the bar at the top of rep 3; elbows stop short of the ribs.",
    },
    {
      t_start: 9.5,
      t_peak: 10.0,
      t_end: 10.5,
      rep_index: 4,
      issue: "knee_kick",
      body_part: "knees",
      severity: 3,
      confidence: 0.7,
      description: "Knees bend and kick forward to help drive rep 4 up.",
    },
    {
      t_start: 12.25,
      t_peak: 12.75,
      t_end: 13.25,
      rep_index: 5,
      issue: "partial_range_top",
      body_part: "elbows",
      severity: 3,
      confidence: 0.65,
      description: "Rep 5 finishes with the chin level with the bar, not over it.",
    },
  ],
  overall: "Strong, steady pulling, but the top of most reps is cut short and the legs kick on the later reps.",
  raw: '{"exercise":"pull_up","view":"front","rep_count":6,"events":[…]}',
  trace: [],
};

export const DEFAULT_COACH: CoachReport = {
  spoken_summary:
    "Solid set, but you're stopping short at the top. Your elbows only bend to about 88°, so your chin never clears the bar. Pull your elbows down to your ribs and keep your legs long — no kicking.",
  headline: "CHIN UNDER THE BAR — PULL HIGHER",
  primary_fault: {
    id: "pullup_top_elbow",
    title: "Partial range at the top",
    explanation:
      "At the top of the rep your elbows stay open at about 88°, well short of the 60–75° needed to bring the chin over the bar. The last few centimetres are where the lats and biceps do the most work.",
    body_part: "elbows",
    severity: 4,
  },
  secondary_faults: [
    {
      title: "Knee kick",
      explanation: "Your knees bend to about 140° to generate momentum. Keep the legs straight and squeeze the glutes.",
    },
  ],
  angle_feedback: [
    {
      angle_key: "elbow_top",
      actual_deg: 88,
      target_min_deg: 45,
      target_max_deg: 75,
      target_ideal_deg: 60,
      verdict: "bad",
      comment: "Elbows need another ~25° of bend to finish the rep.",
    },
    {
      angle_key: "knee_angle",
      actual_deg: 140,
      target_min_deg: 150,
      target_max_deg: 180,
      target_ideal_deg: 175,
      verdict: "borderline",
      comment: "Slight kick; lock the legs out.",
    },
  ],
  cues: [
    "Pull your elbows down to your ribs — chin over the bar.",
    "Squeeze glutes, legs long — no kicking.",
    "Pause one second at the top of every rep.",
  ],
  drill: {
    name: "Negative pull-ups with a top hold",
    prescription: "3 × 4 reps: jump to the top, hold 2 s with chin over the bar, lower over 4 s.",
    why: "Builds strength in the top range you're currently skipping.",
  },
  corrected_pose: {
    description:
      "Top of the pull-up: chin clearly above the bar, elbows fully bent and pulled down to the sides, shoulders level and depressed, body vertical and still, legs straight and together.",
    joint_targets: [
      { angle_key: "elbow_top", target_deg: 60 },
      { angle_key: "knee_angle", target_deg: 175 },
    ],
  },
  safety_note: null,
  form_score_adjustment: -3,
};

const demoDir = (id: DemoId) => path.join(process.cwd(), "public", "demo", id);

function readJson(id: DemoId, file: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(demoDir(id), file), "utf8"));
  } catch {
    return undefined;
  }
}

function readJpegDataUrl(id: DemoId, file: string): string | undefined {
  try {
    const buf = readFileSync(path.join(demoDir(id), file));
    return buf.length ? `data:image/jpeg;base64,${buf.toString("base64")}` : undefined;
  } catch {
    return undefined;
  }
}

/** Scan fixture (provider forced to "demo"). */
export function loadScanFixture(id: DemoId = "pullup"): ScanResult {
  const r = ScanResultSchema.safeParse(readJson(id, "scan.json"));
  const base = r.success ? r.data : DEFAULT_SCAN;
  return { ...base, provider: "demo", trace: base.trace ?? [] };
}

export function loadCoachFixture(id: DemoId = "pullup"): CoachReport {
  const r = CoachReportSchema.safeParse(readJson(id, "coach.json"));
  return r.success ? r.data : DEFAULT_COACH;
}

export function loadAfterImageDataUrl(id: DemoId = "pullup"): string {
  return readJpegDataUrl(id, "after.jpg") ?? TINY_JPEG_DATA_URL;
}

export function loadFrameDataUrl(id: DemoId = "pullup"): string {
  return readJpegDataUrl(id, "frame.jpg") ?? TINY_JPEG_DATA_URL;
}

/**
 * Mock-mode scan for an arbitrary upload. The cached fixture is a pull-up set, so it may only claim
 * "pull_up" when the user chose it; in auto mode `exercise` is left out (the client then classifies
 * from pose) and for another explicit exercise it is that exercise. Events are clamped into the clip.
 */
export function mockScanFor(req: Pick<ScanRequest, "exercise" | "duration">): ScanResult {
  const fx = loadScanFixture("pullup");
  const d = req.duration > 0 ? req.duration : Infinity;
  const clamp = (t: number) => Math.min(Math.max(0, t), d);
  const { exercise: fixtureExercise, ...rest } = fx;
  void fixtureExercise;
  // The fixture's fault words describe a pull-up: keep them only for pull-ups, else timing only.
  const pull = req.exercise === "pull_up";
  const events = fx.events
    .filter((e) => e.t_start < d)
    .map((e) => ({
      ...e,
      t_start: clamp(e.t_start),
      t_peak: clamp(e.t_peak),
      t_end: clamp(e.t_end),
      ...(pull
        ? {}
        : { issue: "hardest_rep", body_part: "full_body", description: `Rep ${e.rep_index ?? ""} flagged by the mock video model (fixture timing).`.replace("Rep  ", "Rep ") }),
    }));
  return {
    ...rest,
    ...(req.exercise !== "auto" ? { exercise: req.exercise } : {}),
    ...(pull ? {} : { overall: "Mock video model: fixture timing only.", raw: JSON.stringify({ mock: true, exercise: req.exercise === "auto" ? null : req.exercise, events }) }),
    events,
  };
}

/**
 * Mock-mode coach: the cached pull-up report for pull-ups, otherwise the rule-based coach built from
 * the request's own measurements (so a push-up never gets pull-up coaching).
 */
export function mockCoachFor(req: Pick<CoachRequest, "exercise" | "view" | "side" | "angles" | "violations" | "cosmosEvent">): CoachReport {
  if (req.exercise === "pull_up") return loadCoachFixture("pullup");
  const { score, grade } = formScore(req.angles);
  const report: AngleReport = {
    exercise: req.exercise,
    view: req.view,
    side: req.side,
    angles: req.angles,
    violations: req.violations,
    score,
    grade,
  };
  return ruleBasedCoach(report, req.cosmosEvent);
}

/**
 * Effective mock delay. `MOCK_DELAY_MS` unset → the realistic default; set to a number N → min(default, N)
 * ("0" disables all delays, which tests use).
 */
export function mockDelayMs(ms: number): number {
  const raw = process.env.MOCK_DELAY_MS;
  if (raw === undefined || raw.trim() === "") return ms;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap < 0) return ms;
  return Math.min(ms, cap);
}

export function mockDelay(ms: number, signal?: AbortSignal): Promise<void> {
  const d = mockDelayMs(ms);
  if (d <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, d);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
