import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";

test("master settings page exposes GST, brands, TDS/TCS, and party category management", async ({ page }) => {
  await loginAsAdmin(page);

  const categoryName = `E2E Category ${Date.now()}`;
  const brandName = `E2E Brand ${Date.now()}`;
  const sku = `E2E-SKU-${Date.now()}`;
  const productName = `E2E Product ${Date.now()}`;

  await page.goto("/masters/settings");

  await expect(page.getByRole("heading", { name: "Master Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GST", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brands", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "TDS / TCS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Party Categories", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Brands", exact: true }).click();
  await page.getByLabel("Brand Name").fill(brandName);
  await page.getByRole("button", { name: "Add Brand" }).click();

  await expect(page.getByText("Brand added")).toBeVisible();
  await expect(page.locator("tr", { hasText: brandName }).first()).toBeVisible();

  await page.getByRole("button", { name: "Party Categories", exact: true }).click();
  await page.getByLabel("Party Category Name").fill(categoryName);
  await page.getByRole("button", { name: "Add Party Category" }).click();

  await expect(page.getByText("Party Category added")).toBeVisible();
  await expect(page.getByRole("cell", { name: categoryName })).toBeVisible();

  const row = page.locator("tr", { hasText: categoryName });
  await row.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText(`Party Category ${categoryName} deleted`)).toBeVisible();
  await expect(page.getByRole("cell", { name: categoryName })).toHaveCount(0);

  await page.goto("/masters/products");
  await page.getByTestId("product-sku").fill(sku);
  await page.getByTestId("product-name").fill(productName);
  await page.getByTestId("product-brand").selectOption({ label: brandName });
  await page.getByRole("button", { name: "Save All Rows (Ctrl+Enter)" }).click();

  await expect(page.getByText("Created 1 items successfully.")).toBeVisible();
  await page.getByPlaceholder("Search by SKU, name, brand, HSN, GST").fill(productName);
  await expect(page.locator("tr", { hasText: productName }).first()).toBeVisible();
});
