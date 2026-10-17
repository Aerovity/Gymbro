import { expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Waits until the analysis is finished and the results screen is shown (all results at once). */
export async function waitForPipelineDone(page: Page, timeout = 120_000) {
  await expect(page.getByTestId("results-screen")).toBeVisible({ timeout });
  await expect(page.getByTestId("step-coach")).toHaveAttribute("data-status", /done|fallback|skipped/, { timeout: 10_000 });
}

/** Opens the collapsible "Under the hood" section (tape, steps) if it is closed. */
export async function openUnderTheHood(page: Page) {
  const toggle = page.getByRole("button", { name: /Under the hood/i });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
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

/** The real push-up clip (7 s, portrait, filmed from behind at ~45°, stands up at the end). */
export function pushupClip(): string {
  return resolve("tests/fixtures/pushup-upload.mp4");
}

export function hasFfmpeg(): boolean {
  return existsSync(resolve("tests/fixtures/pullup-upload.mp4")) || spawnSync("ffmpeg", ["-version"]).status === 0;
}

/** Upload a clip from the landing page with the given exercise chip ("auto" by default). */
export async function uploadFromLanding(page: Page, file: string, chip: "auto" | "push_up" | "pull_up" = "auto") {
  await page.goto("/");
  await page.getByTestId(`exercise-chip-${chip}`).click();
  await page.getByTestId("dropzone-input").setInputFiles(file);
  await expect(page).toHaveURL(/\/analyze/);
}
