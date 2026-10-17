// Converts any phone clip (e.g. iPhone HEVC .MOV) into a browser-safe H.264 MP4.
// Usage: npm run prep-video -- <input> [output] [startSec] [durationSec]
import { spawnSync } from "node:child_process";

const [input, output = "prepared.mp4", start, duration] = process.argv.slice(2);
if (!input) {
  console.error("Usage: npm run prep-video -- <input> [output] [startSec] [durationSec]");
  process.exit(1);
}
const args = ["-y"];
if (start) args.push("-ss", start);
args.push("-i", input);
if (duration) args.push("-t", duration);
args.push("-vf", "scale='if(gt(iw,ih),1280,720)':-2,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-crf", "23", "-an", "-movflags", "+faststart", output);
const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
process.exit(r.status ?? 1);
