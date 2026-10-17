// Validates public/demo/<id>/*.json against the app schemas: tsx scripts/validate-fixtures.ts pullup
import { readFileSync } from "node:fs";
import { CoachReportSchema, ScanResultSchema } from "../src/lib/schemas";

const id = process.argv[2] ?? "pullup";
const read = (f: string) => JSON.parse(readFileSync(`public/demo/${id}/${f}`, "utf8"));
ScanResultSchema.parse(read("scan.json"));
CoachReportSchema.parse(read("coach.json"));
for (const f of ["pose.json", "after-pose.json"]) {
  const p = read(f);
  if (p.landmarks?.length !== 33 || !p.width || !p.height) throw new Error(`${f} is not a PoseResult`);
}
console.log(`demo/${id} fixtures OK`);
