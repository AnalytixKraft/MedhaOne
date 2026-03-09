import { expect, Page, test } from "@playwright/test";

import { resetAndSeed } from "../utils/api";
import { loginAsAdmin } from "../utils/auth";
import { selectErpComboboxOption } from "../utils/erpCombobox";
import { generateData } from "../utils/testData";

async function createMasters(page: Page, prefix: string) {
  const data = generateData(prefix);
  const serial = `${Date.now()}`.slice(-4);
  const supplierGstin = `27ABCDE${serial}F1Z5`;

  const companyResponse = await page.request.put("/api/settings/company", {
    data: {
      company_name: "PO Workflow Org",
      gst_number: "27AKERP0516F1Z3",
      state: "Maharashtra",
    },
  });
  expect(companyResponse.ok()).toBeTruthy();

  const supplierResponse = await page.request.post("/api/masters/parties", {
    data: {
      name: data.supplierName,
      party_type: "SUPPLIER",
      party_category: "STOCKIST",
      gstin: supplierGstin,
      state: "Maharashtra",
      is_active: true,
    },
  });
  expect(supplierResponse.ok()).toBeTruthy();

  const warehouseResponse = await page.request.post("/api/masters/warehouses", {
    data: {
      name: data.warehouseName,
      code: data.warehouseCode,
      is_active: true,
    },
  });
  expect(warehouseResponse.ok()).toBeTruthy();

  const productResponse = await page.request.post("/api/masters/products", {
    data: {
      sku: data.productSku,
      name: data.productName,
      uom: "EA",
      gst_rate: "12.00",
      is_active: true,
    },
  });
  expect(productResponse.ok()).toBeTruthy();

  return data;
}

async function fillDraft(page: Page, supplierName: string, warehouseName: string, productName: string) {
  await selectErpComboboxOption(page, "po-supplier-select", supplierName, supplierName);
  await selectErpComboboxOption(page, "po-warehouse-select", warehouseName, warehouseName);
  await selectErpComboboxOption(page, "po-line-product-0", productName, productName);
  await page.getByTestId("po-line-qty-0").fill("5");
  await page.getByTestId("po-line-cost-0").fill("10");
}

test.beforeEach(async ({ request }) => {
  await resetAndSeed(request, false);
});

test("purchase order draft can be created, edited, approved, and listed", async ({ page }) => {
  await loginAsAdmin(page);
  const data = await createMasters(page, "POFLOW");

  await page.goto("/purchase-orders/new");
  await fillDraft(page, data.supplierName, data.warehouseName, data.productName);
  await page.getByTestId("create-po").click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);
  await expect(page.getByText(data.supplierName)).toBeVisible();
  await expect(page.getByTestId("status-badge")).toContainText("DRAFT");

  await page.getByRole("link", { name: "Edit Draft" }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+\/edit$/);
  await page.getByTestId("po-line-qty-0").fill("8");
  await page.getByTestId("update-po").click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);
  await expect(page.getByText("8.000")).toBeVisible();

  await page.getByRole("button", { name: "Approve PO" }).click();
  await expect(page.getByTestId("status-badge")).toContainText("APPROVED");
  await expect(page.getByRole("link", { name: "Edit Draft" })).toHaveCount(0);

  await page.goto("/purchase-orders");
  const row = page.locator("tbody tr").filter({ hasText: data.supplierName }).first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("status-badge")).toContainText("APPROVED");
});

test("draft purchase order can be cancelled and becomes read-only", async ({ page }) => {
  await loginAsAdmin(page);
  const data = await createMasters(page, "POCANCEL");

  await page.goto("/purchase-orders/new");
  await fillDraft(page, data.supplierName, data.warehouseName, data.productName);
  await page.getByTestId("create-po").click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);

  await page.getByRole("link", { name: "Edit Draft" }).click();
  await page.getByTestId("cancel-po").click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);
  await expect(page.getByTestId("status-badge")).toContainText("CANCELLED");
  await expect(page.getByRole("link", { name: "Edit Draft" })).toHaveCount(0);
});
