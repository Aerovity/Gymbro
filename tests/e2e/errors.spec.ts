import { expect, test } from "@playwright/test";
import { hasFfmpeg, uploadClip, waitForPipelineDone } from "./helpers";

test.describe("fallbacks", () => {
  test.skip(!hasFfmpeg(), "ffmpeg is not installed — cannot build the upload fixture");

  test("video model down → on-device pose scan fallback + demo offer", async ({ page }) => {
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
    await page.goto("/");
    await page.getByTestId("exercise-chip-pull_up").click();
    await page.getByTestId("dropzone-input").setInputFiles(uploadClip());
    await expect(page.getByTestId("step-scan")).toHaveAttribute("data-status", /fallback|failed/, { timeout: 120_000 });
    await expect(page.getByTestId("demo-fallback-btn")).toBeVisible();
  });

  test("demo-results button recovers from a failed scan", async ({ page }) => {
    test.setTimeout(240_000);
    await page.route("**/api/scan", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "scan_failed", message: "down" } }) }),
    );
    await page.goto("/");
    await page.getByTestId("exercise-chip-pull_up").click();
    await page.getByTestId("dropzone-input").setInputFiles(uploadClip());
    await page.getByTestId("demo-fallback-btn").click({ timeout: 120_000 });
    await waitForPipelineDone(page);
    await expect(page.getByTestId("before-after")).toBeVisible();
  });

  test("image edit failure → ghost skeleton + retry", async ({ page }) => {
    await page.route("**/api/correct", (route) =>
      route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "timeout", message: "Image edit timed out" } }) }),
    );
    await page.goto("/analyze?demo=pullup&live=1");
    await waitForPipelineDone(page);
    await expect(page.getByTestId("ghost-overlay")).toBeVisible();
    await expect(page.getByTestId("retry-correct-btn")).toBeVisible();
  });

  test("coach failure → rule-based coach still fills the panel", async ({ page }) => {
    await page.route("**/api/coach", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto("/analyze?demo=pullup&live=1");
    await waitForPipelineDone(page);
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
  });
});
