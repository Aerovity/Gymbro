import { expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Waits until the pipeline stepper reports the verify step as finished (done or fallback). */
export async function waitForPipelineDone(page: Page, timeout = 120_000) {
  await expect(page.getByTestId("step-verify")).toHaveAttribute("data-status", /done|fallback|skipped/, { timeout });
}

/** A short H.264 clip of the real pull-up set for upload tests (generated from the demo clip if missing). */
export function uploadClip(): string {
  const full = resolve("tests/fixtures/pullup-upload.mp4");
  if (existsSync(full)) return full;
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-i", resolve("public/demo/pullup/video.mp4"), "-t", "10", "-c", "copy", full],
    { stdio: "inherit" },
  );
  if (r.status !== 0 || !existsSync(full)) throw new Error("ffmpeg unavailable — cannot build upload fixture");
  return full;
}

export function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}
