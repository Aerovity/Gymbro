// Synthetic landmark fixtures (tests/fixtures/landmarks-*.json), built in code by tests/helpers/pose.ts.
// Regenerate with: UPDATE_FIXTURES=1 npx vitest run tests/unit/fixtures.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeAngleReport } from "@/lib/angles/compute";
import { ruleBasedCoach } from "@/lib/exercises/fallbackCoach";
import { CoachReportSchema } from "@/lib/schemas";
import type { ExerciseId, PoseResult } from "@/lib/types";
import { benchFront, pullUp, sidePushUp, sideSquat } from "../helpers/pose";

const FIXTURES: Record<string, { exercise: ExerciseId; build: () => PoseResult; expectPrimary: string | null }> = {
  "landmarks-squat-bad.json": { exercise: "squat", build: () => sideSquat({ knee: 115, tibia: 25, torso: 47 }), expectPrimary: "squat_depth" },
  "landmarks-bench-flare.json": { exercise: "bench_press", build: () => benchFront({ flareL: 85, flareR: 80 }), expectPrimary: "bench_elbow_flare" },
  "landmarks-pullup-partial.json": {
    exercise: "pull_up",
    build: () => pullUp({ elbowL: 98, elbowR: 104, knee: 128, noseVis: 0.3 }),
    expectPrimary: "pullup_top_elbow",
  },
  "landmarks-pullup-good.json": { exercise: "pull_up", build: () => pullUp({ elbowL: 58, elbowR: 60, noseVis: 0.3 }), expectPrimary: null },
  "landmarks-pushup-sag.json": { exercise: "push_up", build: () => sidePushUp({ elbow: 85, hipOffset: 0.3 }), expectPrimary: "pushup_body_line" },
  "landmarks-pushup-shallow.json": { exercise: "push_up", build: () => sidePushUp({ elbow: 125 }), expectPrimary: "pushup_depth" },
};

const path = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

describe("landmark fixtures", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name} matches its builder and analyses as expected`, () => {
      const built = f.build();
      if (process.env.UPDATE_FIXTURES || !existsSync(path(name))) {
        writeFileSync(path(name), JSON.stringify(built, null, 1) + "\n");
      }
      const pose = JSON.parse(readFileSync(path(name), "utf8")) as PoseResult;
      expect(pose.landmarks).toHaveLength(33);
      expect(pose.landmarks[11].x).toBeCloseTo(built.landmarks[11].x, 9);
      const report = computeAngleReport(pose, f.exercise);
      expect(report.violations[0]?.ruleId ?? null).toBe(f.expectPrimary);
      expect(() => CoachReportSchema.parse(ruleBasedCoach(report))).not.toThrow();
    });
  }
});
