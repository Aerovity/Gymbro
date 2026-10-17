import { expect, test } from "@playwright/test";
import { hasFfmpeg, uploadClip, uploadFromLanding, waitForPipelineDone } from "./helpers";

test.describe("fallbacks", () => {
  test.skip(!hasFfmpeg(), "ffmpeg is not installed — cannot build the upload fixture");

  test("video model down → on-device pose scan fallback completes + demo offer", async ({ page }) => {
    test.setTimeout(240_000);
    await page.route("**/api/scan", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "scan_failed", message: "All video providers failed" },
          trace: [{ step: "scan", provider: "cosmos", ok: false, ms: 10, error: "404" }],
        }),
      }),
    );
    await uploadFromLanding(page, uploadClip(), "pull_up");
    await expect(page.getByTestId("step-scan")).toHaveAttribute("data-status", /fallback|failed/, { timeout: 120_000 });
    await expect(page.getByTestId("demo-fallback-btn")).toBeVisible();
    // The pose-only path still produces full results, with the fallback notice kept.
    await waitForPipelineDone(page, 200_000);
    await expect(page.getByTestId("demo-fallback-btn")).toBeVisible();
    await expect(page.getByText(/scanned your set on-device/i)).toBeVisible();
    expect(await page.getByTestId("angle-card").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
  });

  test("demo-results button recovers from a failed scan", async ({ page }) => {
    test.setTimeout(240_000);
    await page.route("**/api/scan", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "scan_failed", message: "down" } }) }),
    );
    await uploadFromLanding(page, uploadClip(), "pull_up");
    await page.getByTestId("demo-fallback-btn").click({ timeout: 120_000 });
    await expect(page).toHaveURL(/demo=pullup/);
    await waitForPipelineDone(page);
    await expect(page.getByTestId("before-after")).toBeVisible();
    await expect(page.getByTestId("exercise-badge")).toContainText(/Pull-up/i);
  });

  test("AI photo failure → failed state with retry, target-form ghost still shown", async ({ page }) => {
    test.setTimeout(240_000);
    await page.route("**/api/correct", (route) =>
      route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "timeout", message: "Image edit timed out" } }) }),
    );
    await page.goto("/analyze?demo=pullup&live=1");
    await waitForPipelineDone(page, 200_000);
    // The target-form skeleton is on by default — no AI photo needed.
    await expect(page.getByTestId("ghost-overlay")).toBeVisible();
    await page.getByTestId("ai-photo-btn").click();
    const btn = page.getByTestId("ai-photo-btn");
    await expect(btn).toHaveAttribute("data-state", "failed", { timeout: 60_000 });
    await expect(btn).toBeEnabled();
    await expect(page.getByText(/AI photo took too long/i)).toBeVisible();
    await expect(page.getByTestId("ghost-overlay")).toBeVisible();
  });

  test("coach failure → rule-based coach still fills the panel", async ({ page }) => {
    test.setTimeout(240_000);
    await page.route("**/api/coach", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto("/analyze?demo=pullup&live=1");
    await waitForPipelineDone(page, 200_000);
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
    await expect(page.getByTestId("step-coach")).toHaveAttribute("data-status", "fallback");
  });
});
