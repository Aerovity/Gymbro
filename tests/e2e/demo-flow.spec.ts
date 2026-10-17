import { expect, test } from "@playwright/test";
import { waitForPipelineDone } from "./helpers";

test.describe("demo flow", () => {
  test("sample pull-up runs the full pipeline @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByTestId("sample-pullup").first().click();
    await expect(page).toHaveURL(/\/analyze/);

    await expect(page.getByTestId("stepper")).toBeVisible();
    await waitForPipelineDone(page);

    await expect(page.getByTestId("found-banner")).toContainText(/FOUND BAD REP AT/i);
    expect(await page.getByTestId("timeline-marker").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("before-after")).toBeVisible();
    expect(await page.getByTestId("angle-card").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("coach-text")).not.toBeEmpty();
    await expect(page.getByTestId("form-score")).toBeVisible();
  });

  test("skeleton toggle hides and shows overlays on both panes", async ({ page }) => {
    await page.goto("/analyze?demo=pullup");
    await waitForPipelineDone(page);
    const overlays = page.getByTestId("before-after").locator('[data-testid^="pose-overlay"]');
    await expect(overlays.first()).toBeVisible();
    expect(await overlays.count()).toBeGreaterThanOrEqual(2);

    await page.getByTestId("skeleton-toggle").click();
    await expect(overlays.first()).toBeHidden();
    await page.keyboard.press("s");
    await expect(overlays.first()).toBeVisible();
  });

  test("download produces a PNG", async ({ page }) => {
    await page.goto("/analyze?demo=pullup");
    await waitForPipelineDone(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-btn").click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });

  test("agent trace shows the video model output", async ({ page }) => {
    await page.goto("/analyze?demo=pullup");
    await waitForPipelineDone(page);
    await page.getByTestId("trace-btn").click();
    await expect(page.getByRole("dialog")).toContainText(/events/i);
  });

  test("keyboard D on landing starts the demo", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sample-pullup").first()).toBeVisible();
    // Retry until hydration has attached the key listener.
    await expect(async () => {
      await page.keyboard.press("d");
      await expect(page).toHaveURL(/\/analyze/, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  });
});

test.describe("3D replay", () => {
  test("toggles the animated 3D mannequins @mobile", async ({ page }) => {
    await page.goto("/analyze?demo=pullup");
    await waitForPipelineDone(page);
    await page.getByTestId("view-3d").click();
    const stage = page.getByTestId("form-3d");
    await expect(stage.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expect(stage).toContainText(/You/i);
    await stage.getByRole("radio", { name: /Ghost/ }).click();
    await stage.getByRole("radio", { name: "Side", exact: true }).click();
    await page.getByRole("button", { name: /Pause replay/ }).click();
    await expect(page.getByRole("button", { name: /Play replay/ })).toBeVisible();
    // keyboard "3" returns to the photo view
    await page.keyboard.press("3");
    await expect(stage).toBeHidden();
    await expect(page.getByTestId("before-after")).toBeVisible();
  });
});
