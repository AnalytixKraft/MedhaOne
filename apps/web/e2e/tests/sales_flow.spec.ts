import { expect, type Locator, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";

async function selectFirstNonEmptyOption(locator: Locator) {
  const value = await locator.evaluate((element) => {
    const select = element as HTMLSelectElement;
    const option = Array.from(select.options).find((candidate) => candidate.value);
    return option?.value ?? null;
  });

  if (!value) {
    return false;
  }

  await locator.selectOption(value);
  return true;
}

test("sales screens load and can save a draft order when master data exists", async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByTestId("nav-sales").first().click();
  await expect(page).toHaveURL(/\/sales(?:\/|$)/);
  await expect(page.getByTestId("nav-sales-orders").first()).toBeVisible();
  await expect(page.getByTestId("nav-sales-dispatches").first()).toBeVisible();

  await page.goto("/sales/orders");
  await expect(page.locator("h1", { hasText: "Sales Orders" })).toBeVisible();
  await expect(page.getByTestId("sales-order-customer")).toBeVisible();
  await expect(page.getByTestId("sales-order-warehouse")).toBeVisible();

  const hasCustomer = await selectFirstNonEmptyOption(page.getByTestId("sales-order-customer"));
  const hasWarehouse = await selectFirstNonEmptyOption(page.getByTestId("sales-order-warehouse"));
  const hasProduct = await selectFirstNonEmptyOption(page.getByTestId("sales-order-line-product-0"));

  if (hasCustomer && hasWarehouse && hasProduct) {
    await page.getByTestId("sales-order-line-qty-0").fill("1");
    await page.getByTestId("sales-order-save").click();
    await expect(page.getByTestId("sales-order-result")).toContainText("Created sales order");
  }

  await page.goto("/sales/dispatches");
  await expect(page.locator("h1", { hasText: "Dispatch Notes" })).toBeVisible();
  await expect(page.getByText("Create From Sales Order")).toBeVisible();
});
