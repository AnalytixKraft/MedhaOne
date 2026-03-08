import { expect, Page, test } from "@playwright/test";

import { E2E_ORG_SLUG, expectStockQty, resetAndSeed } from "../utils/api";
import { loginAsAdmin } from "../utils/auth";
import { selectErpComboboxOption } from "../utils/erpCombobox";
import { GeneratedData, generateData } from "../utils/testData";

type GstSetup = {
  companyGstin?: string | null;
  companyState?: string | null;
  supplierGstin?: string | null;
  supplierState?: string | null;
};

async function createMasters(
  page: Page,
  data: GeneratedData,
  gstSetup: GstSetup = {},
): Promise<void> {
  const companyResponse = await page.request.patch("/api/settings/company", {
    data: {
      company_name: "E2E Isolated Workspace",
      gst_number: gstSetup.companyGstin ?? "27AAAAA1111A1Z1",
      state: gstSetup.companyState ?? "Maharashtra",
    },
  });
  expect(companyResponse.ok()).toBeTruthy();

  const supplierResponse = await page.request.post("/api/masters/parties", {
    data: {
      name: data.supplierName,
      party_type: "SUPER_STOCKIST",
      state: gstSetup.supplierState ?? "Maharashtra",
      gstin: gstSetup.supplierGstin ?? "27ABCDE1234F1Z5",
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
}

async function createAndApprovePo(
  page: Page,
  data: GeneratedData,
  qty: string,
  unitCost = "100",
): Promise<void> {
  await page.goto("/purchase/po");
  await selectErpComboboxOption(
    page,
    "po-supplier-select",
    data.supplierName,
    data.supplierName,
  );
  await selectErpComboboxOption(
    page,
    "po-warehouse-select",
    data.warehouseName,
    data.warehouseName,
  );
  await selectErpComboboxOption(
    page,
    "po-line-product-0",
    `${data.productSku} - ${data.productName}`,
    data.productSku,
  );
  await expect(page.getByTestId("po-tax-select")).toContainText("12");
  await page.getByTestId("po-line-qty-0").fill(qty);
  await page.getByTestId("po-line-cost-0").fill(unitCost);
  await page.getByTestId("create-po").click();

  const poRow = page
    .locator("tbody tr")
    .filter({ hasText: data.supplierName })
    .first();
  await expect(poRow).toBeVisible();
  await expect(poRow.getByTestId("status-badge")).toHaveText("DRAFT");

  await poRow.getByTestId("approve-po").click();
  await expect(poRow.getByTestId("status-badge")).toHaveText("APPROVED");
}

async function createGrnFromPo(
  page: Page,
  data: GeneratedData,
  qty: string,
): Promise<void> {
  await page.goto("/purchase/grn");

  await selectErpComboboxOption(page, "grn-po-select");
  await page.locator('[data-testid^="grn-line-qty-"]').first().fill(qty);
  await page
    .locator('[data-testid^="grn-line-batch-"]')
    .first()
    .fill(data.batchNo);
  await page
    .locator('[data-testid^="grn-line-expiry-"]')
    .first()
    .fill(data.expiryDate);
  await page.getByTestId("create-grn-from-po").click();

  const firstGrnRow = page.locator("tbody tr").first();
  await expect(firstGrnRow).toBeVisible();
  await expect(firstGrnRow.getByTestId("status-badge")).toHaveText("DRAFT");
  await firstGrnRow.getByRole("link", { name: "View" }).click();
}

async function postCurrentGrn(page: Page): Promise<number> {
  await expect(page.getByTestId("post-grn")).toBeVisible();
  await page.getByTestId("post-grn").click();
  await expect(page.getByTestId("status-badge").first()).toHaveText("POSTED");

  const url = page.url();
  const grnId = Number(url.split("/").pop());
  if (!Number.isFinite(grnId)) {
    throw new Error(`Unable to read GRN id from URL: ${url}`);
  }
  return grnId;
}

test.beforeEach(async ({ request }) => {
  await resetAndSeed(request, false);
});

test("Same-state supplier shows GST split and correct PO total", async ({
  page,
}) => {
  const data = generateData("GSTINTRA");

  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyGstin: "27AAAAA1111A1Z1",
    companyState: "Maharashtra",
    supplierGstin: "27ABCDE1234F1Z5",
    supplierState: "Maharashtra",
  });

  await page.goto("/purchase/po");
  await selectErpComboboxOption(
    page,
    "po-supplier-select",
    data.supplierName,
    data.supplierName,
  );
  await selectErpComboboxOption(
    page,
    "po-warehouse-select",
    data.warehouseName,
    data.warehouseName,
  );
  await selectErpComboboxOption(
    page,
    "po-line-product-0",
    `${data.productSku} - ${data.productName}`,
    data.productSku,
  );
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-supplier-gstin")).toContainText("27ABCDE1234F1Z5");
  await expect(page.getByTestId("po-company-gstin")).toContainText("27AAAAA1111A1Z1");
  await expect(page.getByTestId("po-tax-mode-badge")).toHaveText("Intra-state");
  await expect(page.getByTestId("po-tax-split")).toContainText("CGST 6.00% + SGST 6.00%");
  await expect(page.getByText("Taxable Value")).toBeVisible();
  await expect(page.getByText("CGST 6.00%")).toBeVisible();
  await expect(page.getByText("SGST 6.00%")).toBeVisible();
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");
});

test("Different-state supplier switches to IGST", async ({ page }) => {
  const data = generateData("GSTINTER");

  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyGstin: "27AAAAA1111A1Z1",
    companyState: "Maharashtra",
    supplierGstin: "29ABCDE1234F1Z5",
    supplierState: "Karnataka",
  });

  await page.goto("/purchase/po");
  await selectErpComboboxOption(
    page,
    "po-supplier-select",
    data.supplierName,
    data.supplierName,
  );
  await selectErpComboboxOption(
    page,
    "po-warehouse-select",
    data.warehouseName,
    data.warehouseName,
  );
  await selectErpComboboxOption(
    page,
    "po-line-product-0",
    `${data.productSku} - ${data.productName}`,
    data.productSku,
  );
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-tax-mode-badge")).toHaveText("Inter-state");
  await expect(page.getByTestId("po-tax-split")).toContainText("IGST 12.00%");
  await expect(page.getByText("IGST 12.00%")).toBeVisible();
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");
});

test("Missing company GST shows warning and blocks save before generic server failure", async ({
  page,
}) => {
  const data = generateData("GSTWARN");

  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyGstin: null,
    companyState: "Maharashtra",
    supplierGstin: "27ABCDE1234F1Z5",
    supplierState: "Maharashtra",
  });

  await page.goto("/purchase/po");
  await selectErpComboboxOption(
    page,
    "po-supplier-select",
    data.supplierName,
    data.supplierName,
  );
  await selectErpComboboxOption(
    page,
    "po-warehouse-select",
    data.warehouseName,
    data.warehouseName,
  );
  await selectErpComboboxOption(
    page,
    "po-line-product-0",
    `${data.productSku} - ${data.productName}`,
    data.productSku,
  );

  await expect(page.getByText("Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.")).toBeVisible();
  await expect(page.getByTestId("create-po")).toBeDisabled();
});

test("PO -> GRN end-to-end closes PO and updates stock", async ({
  page,
  request,
}) => {
  const data = generateData("E2E");

  await loginAsAdmin(page);
  await createMasters(page, data);
  await createAndApprovePo(page, data, "10");

  await createGrnFromPo(page, data, "10");
  await postCurrentGrn(page);

  await page.goto("/purchase/po");
  const poRow = page
    .locator("tbody tr")
    .filter({ hasText: data.supplierName })
    .first();
  await expect(poRow.getByTestId("status-badge")).toHaveText("CLOSED");

  await expectStockQty(
    request,
    {
      warehouse_code: data.warehouseCode,
      product_sku: data.productSku,
      batch_no: data.batchNo,
      expiry_date: data.expiryDate,
    },
    "10.000",
  );
});

test("Partial GRN then final GRN transitions PO to CLOSED and sums stock", async ({
  page,
  request,
}) => {
  const data = generateData("PAR");

  await loginAsAdmin(page);
  await createMasters(page, data);
  await createAndApprovePo(page, data, "10");

  await createGrnFromPo(page, data, "6");
  await postCurrentGrn(page);

  await page.goto("/purchase/po");
  let poRow = page
    .locator("tbody tr")
    .filter({ hasText: data.supplierName })
    .first();
  await expect(poRow.getByTestId("status-badge")).toHaveText(
    "PARTIALLY_RECEIVED",
  );

  await expectStockQty(
    request,
    {
      warehouse_code: data.warehouseCode,
      product_sku: data.productSku,
      batch_no: data.batchNo,
      expiry_date: data.expiryDate,
    },
    "6.000",
  );

  await createGrnFromPo(page, data, "4");
  await postCurrentGrn(page);

  await page.goto("/purchase/po");
  poRow = page
    .locator("tbody tr")
    .filter({ hasText: data.supplierName })
    .first();
  await expect(poRow.getByTestId("status-badge")).toHaveText("CLOSED");

  await expectStockQty(
    request,
    {
      warehouse_code: data.warehouseCode,
      product_sku: data.productSku,
      batch_no: data.batchNo,
      expiry_date: data.expiryDate,
    },
    "10.000",
  );
});

test("Over-receipt is blocked in GRN creation", async ({ page, request }) => {
  const data = generateData("OVR");

  await loginAsAdmin(page);
  await createMasters(page, data);
  await createAndApprovePo(page, data, "5");

  await page.goto("/purchase/grn");
  await selectErpComboboxOption(page, "grn-po-select");
  await page.locator('[data-testid^="grn-line-qty-"]').first().fill("6");
  await page
    .locator('[data-testid^="grn-line-batch-"]')
    .first()
    .fill(data.batchNo);
  await page
    .locator('[data-testid^="grn-line-expiry-"]')
    .first()
    .fill(data.expiryDate);
  await page.getByTestId("create-grn-from-po").click();

  await expect(page.getByText("Cannot receive more than remaining quantity")).toBeVisible();

  const stockResp = await request.get(
    `${process.env.E2E_API_BASE_URL ?? "http://localhost:1730"}/test/stock-summary?warehouse_code=${encodeURIComponent(
      data.warehouseCode,
    )}&product_sku=${encodeURIComponent(data.productSku)}&batch_no=${encodeURIComponent(data.batchNo)}&expiry_date=${data.expiryDate}&org_slug=${encodeURIComponent(E2E_ORG_SLUG)}`,
  );
  expect(stockResp.status()).toBe(404);
});

test("Double post is blocked and does not duplicate stock", async ({
  page,
  request,
}) => {
  const data = generateData("DBL");

  await loginAsAdmin(page);
  await createMasters(page, data);
  await createAndApprovePo(page, data, "5");

  await createGrnFromPo(page, data, "5");
  const grnId = await postCurrentGrn(page);

  const secondPost = await page.request.post(`/api/purchase/grn/${grnId}/post`);
  expect(secondPost.status()).toBe(409);

  await expectStockQty(
    request,
    {
      warehouse_code: data.warehouseCode,
      product_sku: data.productSku,
      batch_no: data.batchNo,
      expiry_date: data.expiryDate,
    },
    "5.000",
  );
});
