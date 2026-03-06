import { expect, test } from "@playwright/test";

const superAdminEmail = process.env.RBAC_SUPER_ADMIN_EMAIL ?? "superadmin@medhaone.app";
const superAdminPassword =
  process.env.RBAC_SUPER_ADMIN_PASSWORD ?? "ChangeThisImmediately!";

test("super admin can click Edit on global GST template and enter update mode", async ({
  page,
}) => {
  await page.goto("/rbac/login");
  await page.getByPlaceholder("Email").fill(superAdminEmail);
  await page.getByPlaceholder("Password").fill(superAdminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/rbac\/super-admin/);

  await page.goto("/rbac/super-admin/settings");
  await expect(
    page.getByRole("heading", { name: "Global GST Template Rates" }),
  ).toBeVisible();

  const editButton = page.getByRole("button", { name: /^Edit/ }).first();
  await expect(editButton).toBeEnabled();
  await editButton.click();

  await expect(page.getByRole("button", { name: "Update Template" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel Edit" })).toBeVisible();
});
