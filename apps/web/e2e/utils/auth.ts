import { expect, Page } from "@playwright/test";

import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./api";

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(E2E_USER_EMAIL);
  await page.getByTestId("login-password").fill(E2E_USER_PASSWORD);
  await page.getByTestId("login-submit").click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Authenticated Session")).toBeVisible();
}
