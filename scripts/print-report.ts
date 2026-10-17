// Prints the AngleReport + rule-based coach for a pose fixture: tsx scripts/print-report.ts public/demo/pullup/pose.json pull_up
import { readFileSync } from "node:fs";
import { computeAngleReport } from "../src/lib/angles/compute";
import { ruleBasedCoach } from "../src/lib/exercises/fallbackCoach";
import type { ExerciseId, PoseResult } from "../src/lib/types";

const [file, ex = "pull_up"] = process.argv.slice(2);
const pose = JSON.parse(readFileSync(file, "utf8")) as PoseResult;
const report = computeAngleReport(pose, ex as ExerciseId);
console.log(JSON.stringify({ report, coach: ruleBasedCoach(report) }, null, 2));
