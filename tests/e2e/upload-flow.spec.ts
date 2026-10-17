import { expect, test, type Page } from "@playwright/test";
import { hasFfmpeg, pushupClip, uploadClip, uploadFromLanding, waitForPipelineDone } from "./helpers";

/** The analyzing screen plays the user's own clip (a blob: URL), never the cached sample. */
async function expectOwnVideo(page: Page) {
  const screen = page.getByTestId("analyzing-screen");
  await expect(screen).toBeVisible();
  const video = screen.locator("video").first();
  await expect(video).toBeAttached();
  const src = await video.evaluate((v: HTMLVideoElement) => v.currentSrc || v.src);
  expect(src).toMatch(/^blob:/);
  expect(src).not.toContain("/demo/");
  // No previous run's results or sample media flash in.
  await expect(page.getByTestId("results-screen")).toHaveCount(0);
  expect(await page.locator('video[src*="/demo/"], img[src*="/demo/"]').count()).toBe(0);
}

test.describe("upload flow (real MediaPipe in Chrome, mocked AI routes)", () => {
  test.skip(!hasFfmpeg(), "ffmpeg is not installed — cannot build the upload fixture");

  test("auto-detects a real pull-up clip and shows the user's own video while analysing", async ({ page }) => {
    test.setTimeout(240_000);
    // Visit the sample first so a stale run could flash if the store weren't reset.
    await page.goto("/analyze?demo=pullup");
    await waitForPipelineDone(page);
    await uploadFromLanding(page, uploadClip(), "auto");
    await expectOwnVideo(page);
    await waitForPipelineDone(page, 200_000);
    await expect(page.getByTestId("exercise-badge")).toContainText(/Pull-up/i);
    await expect(page.getByTestId("found-banner")).toContainText(/FOUND BAD REP AT/i);
    await expect(page.getByTestId("before-after")).toBeVisible();
    expect(await page.getByTestId("angle-card").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
    // No AI photo until asked for: the target-form ghost shows the fix.
    await expect(page.getByTestId("ai-photo-btn")).toHaveAttribute("data-state", "idle");
  });

  test("auto-detects the real push-up clip (filmed from behind) → push-up results, no pull-up bar", async ({ page }) => {
    test.setTimeout(240_000);
    await uploadFromLanding(page, pushupClip(), "auto");
    await expectOwnVideo(page);
    await waitForPipelineDone(page, 200_000);
    const results = page.getByTestId("results-screen");
    await expect(page.getByTestId("exercise-badge")).toContainText(/Push-up/i);
    expect(await page.getByTestId("angle-card").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
    // Nothing pull-up specific on a push-up report.
    await expect(results).not.toContainText(/pull-up|chin over|the bar\b/i);

    await page.getByTestId("view-3d").click();
    const stage = page.getByTestId("form-3d");
    await expect(stage.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expect(stage).toContainText(/You/i);
    await expect(stage).not.toContainText(/\bbar\b/i);
  });

  test("changing the detected exercise re-analyses the clip", async ({ page }) => {
    test.setTimeout(300_000);
    await uploadFromLanding(page, uploadClip(), "auto");
    await waitForPipelineDone(page, 200_000);
    await expect(page.getByTestId("exercise-badge")).toContainText(/Pull-up/i);

    await page.getByTestId("exercise-change-btn").click();
    await page.getByTestId("exercise-change-push_up").click();
    await waitForPipelineDone(page, 200_000);
    await expect(page.getByTestId("exercise-badge")).toContainText(/Push-up/i);
    await expect(page.getByTestId("exercise-badge")).toContainText(/your pick/i);
    await expect(page.getByTestId("results-screen")).toBeVisible();
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
  });

  test("rejects a non-video file with a helpful message", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("dropzone-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a video"),
    });
    await expect(page.getByText(/not a video/i)).toBeVisible();
    await expect(page).not.toHaveURL(/\/analyze/);
  });
});

test.describe("AI photo on demand", () => {
  test("live sample: Generate AI photo → before/after slider", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/analyze?demo=pullup&live=1");
    await waitForPipelineDone(page, 200_000);
    const btn = page.getByTestId("ai-photo-btn");
    await expect(btn).toHaveAttribute("data-state", "idle");
    await btn.click();
    await expect(page.getByTestId("ai-photo-btn")).toHaveAttribute("data-state", /generating|verifying|done/);
    await expect(page.getByTestId("ai-photo-btn")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    await expect(page.getByTestId("before-after")).toBeVisible();
    await expect(page.getByTestId("pose-overlay-after")).toBeAttached();
  });
});
