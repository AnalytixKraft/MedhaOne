import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";

test("theme preference persists on reports screens", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/reports/current-stock");
  await expect(page.getByText("Report Filters")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Filters" })).toBeVisible();
  await expect(page.getByText("Rows")).toBeVisible();

  await page.getByTestId("theme-preference-dark").click();
  await expect(page.getByTestId("theme-preference-dark")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);

  await page.reload();
  await expect(page.getByTestId("theme-preference-dark")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);

  await page.getByTestId("theme-preference-light").click();
  await expect(page.getByTestId("theme-preference-light")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(false);
});
