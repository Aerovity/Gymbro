import { expect, test } from "@playwright/test";
import { hasFfmpeg, uploadClip, waitForPipelineDone } from "./helpers";

test.describe("upload flow (real MediaPipe in Chrome, mocked AI routes)", () => {
  test.skip(!hasFfmpeg(), "ffmpeg is not installed — cannot build the upload fixture");

  test("uploading a real pull-up clip completes the pipeline", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await page.getByTestId("exercise-chip-pull_up").click();
    await page.getByTestId("dropzone-input").setInputFiles(uploadClip());
    await expect(page).toHaveURL(/\/analyze/);
    await waitForPipelineDone(page, 200_000);
    await expect(page.getByTestId("found-banner")).toContainText(/FOUND BAD REP AT/i);
    await expect(page.getByTestId("before-after")).toBeVisible();
    expect(await page.getByTestId("angle-card").count()).toBeGreaterThanOrEqual(1);
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
