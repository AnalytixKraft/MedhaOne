import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";

test("main navigation keeps masters and reports outside inventory", async ({
  page,
}) => {
  await loginAsAdmin(page);

  await page.getByTestId("nav-inventory").first().click();
  await expect(page).toHaveURL(/\/inventory(?:\?|$)/);
  await expect(page.getByTestId("nav-inventory-stock-operations").first()).toBeVisible();
  await expect(page.getByTestId("nav-inventory-setup").first()).toBeVisible();
  await expect(page.getByTestId("nav-inventory-master-data")).toHaveCount(0);
  await expect(page.getByTestId("nav-inventory-reports")).toHaveCount(0);
  await expect(page.getByTestId("nav-inventory-stock-operations-grn")).toHaveCount(0);

  await page.getByTestId("nav-purchase").first().click();
  await expect(page).toHaveURL(/\/purchase(?:\/|$)/);
  await expect(page.getByTestId("nav-purchase-po").first()).toBeVisible();
  await expect(page.getByTestId("nav-purchase-grn").first()).toBeVisible();

  await page.getByTestId("nav-masters").first().click();
  await expect(page).toHaveURL(/\/masters(?:\/|$)/);
  await expect(page.getByTestId("nav-masters-parties").first()).toBeVisible();
  await expect(page.getByTestId("nav-masters-products").first()).toBeVisible();
  await expect(page.getByTestId("nav-masters-warehouses").first()).toBeVisible();

  await page.getByTestId("nav-reports").first().click();
  await expect(page).toHaveURL(/\/reports(?:\/|$)/);
  await expect(page.getByTestId("nav-reports-current-stock").first()).toBeVisible();
  await expect(page.getByTestId("nav-reports-stock-movement").first()).toBeVisible();
  await expect(page.getByTestId("nav-reports-stock-ageing").first()).toBeVisible();
});
