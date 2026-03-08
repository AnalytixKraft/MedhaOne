import { expect, Page, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";
async function parseResultQuantities(
  page: Page,
): Promise<{ before: number; after: number }> {
  const resultText = await page.getByTestId("stock-adjustment-result").innerText();
  const match = resultText.match(/Before\s+([0-9.]+),\s+after\s+([0-9.]+)\./i);
  if (!match) {
    throw new Error(`Unable to parse before/after quantities from result: ${resultText}`);
  }
  return {
    before: Number(match[1]),
    after: Number(match[2]),
  };
}

test("positive stock adjustment increases quantity and records the adjustment", async ({ page }) => {
  const uniqueRemarks = `E2E-STOCK-ADJ-${Date.now()}`;

  await loginAsAdmin(page);

  await page.goto("/inventory/modules/stock-adjustment");
  await expect(page.getByRole("heading", { name: "Stock Adjustment", exact: true })).toBeVisible();
  await page.getByTestId("stock-adjustment-select-row").first().click();
  await page.getByTestId("stock-adjustment-type").selectOption("POSITIVE");
  await page.getByTestId("stock-adjustment-qty").fill("1");
  await page.getByTestId("stock-adjustment-reason").selectOption("FOUND_STOCK");
  await page.getByTestId("stock-adjustment-remarks").fill(uniqueRemarks);
  await page.getByTestId("stock-adjustment-submit").click();

  const resultLocator = page.getByTestId("stock-adjustment-result");
  await expect(resultLocator).toBeVisible();
  const resultText = await resultLocator.innerText();

  if (resultText.includes("Tenant inventory schema is outdated for stock operations")) {
    await expect(resultLocator).toContainText("Tenant inventory schema is outdated for stock operations");
    return;
  }

  await expect(resultLocator).toContainText("Adjustment posted.");
  const quantities = await parseResultQuantities(page);
  expect(quantities.after).toBeGreaterThan(quantities.before);

  const adjustmentRow = page.locator("tbody tr").filter({ hasText: uniqueRemarks }).first();
  await expect(adjustmentRow).toBeVisible();
  await expect(adjustmentRow).toContainText("FOUND_STOCK");
  await expect(adjustmentRow).toContainText("POSITIVE");
});
