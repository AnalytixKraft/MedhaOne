import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";

test("settings page loads without invalid token errors", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/settings");

  await expect(page.locator("h1", { hasText: "Settings" })).toBeVisible();
  await expect(page.getByText("Company profile, users, and branding controls for the current organization.")).toBeVisible();
  await expect(page.getByText("Invalid token")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Bulk Import" })).toHaveCount(0);
});

test("company profile derives state and pan from gst number", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Company Profile" }).click();
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.getByLabel("GST Number").fill("27abcde1234f1z5");

  await expect(page.getByLabel("PAN Number")).toHaveValue("ABCDE1234F");
  await expect(page.getByLabel("State")).toHaveValue("Maharashtra");
});

test("company profile saves without server error and masters exposes bulk import", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Company Profile" }).click();
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.getByLabel("Company Name").fill("Kraft Test Org");
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect(page.getByText("Internal Server Error")).toHaveCount(0);
  await expect(page.getByText("Company profile updated")).toBeVisible();

  await page.goto("/masters");
  await expect(page.getByTestId("masters-bulk-import-card")).toBeVisible();
  await page.goto("/settings/bulk-import");
  await expect(page).toHaveURL(/\/masters\/bulk-import$/);
});
