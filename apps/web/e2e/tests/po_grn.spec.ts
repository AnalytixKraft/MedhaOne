import { expect, Page, test } from "@playwright/test";

import { expectStockQty, resetAndSeed } from "../utils/api";
import { loginAsAdmin } from "../utils/auth";
import { GeneratedData, generateData } from "../utils/testData";

async function createMasters(page: Page, data: GeneratedData): Promise<void> {
  await page.getByTestId("nav-masters").click();

  await page.goto("/masters/parties");
  await page.getByTestId("party-name").fill(data.supplierName);
  await page.getByTestId("party-type").selectOption("SUPER_STOCKIST");
  await page.getByTestId("create-party").click();
  await expect(
    page.getByRole("cell", { name: data.supplierName }),
  ).toBeVisible();

  await page.goto("/masters/warehouses");
  await page.getByTestId("warehouse-name").fill(data.warehouseName);
  await page.getByTestId("warehouse-code").fill(data.warehouseCode);
  await page.getByTestId("create-warehouse").click();
  await expect(
    page.getByRole("cell", { name: data.warehouseCode }),
  ).toBeVisible();

  await page.goto("/masters/products");
  await page.getByTestId("product-sku").fill(data.productSku);
  await page.getByTestId("product-name").fill(data.productName);
  await page.getByTestId("create-product").click();
  await expect(page.getByRole("cell", { name: data.productSku })).toBeVisible();
}

async function createAndApprovePo(
  page: Page,
  data: GeneratedData,
  qty: string,
): Promise<void> {
  await page.goto("/purchase/po");
  await page
    .getByTestId("po-supplier-select")
    .selectOption({ label: data.supplierName });
  await page
    .getByTestId("po-warehouse-select")
    .selectOption({ label: data.warehouseName });
  await page
    .getByTestId("po-line-product-0")
    .selectOption({ label: `${data.productSku} - ${data.productName}` });
  await page.getByTestId("po-line-qty-0").fill(qty);
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

  await page.getByTestId("grn-po-select").selectOption({ index: 1 });
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
  await page.getByTestId("grn-po-select").selectOption({ index: 1 });
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

  await expect(
    page.getByText("Received quantity exceeds remaining quantity on PO line"),
  ).toBeVisible();

  const stockResp = await request.get(
    `${process.env.E2E_API_BASE_URL ?? "http://localhost:1730"}/test/stock-summary?warehouse_code=${encodeURIComponent(
      data.warehouseCode,
    )}&product_sku=${encodeURIComponent(data.productSku)}&batch_no=${encodeURIComponent(data.batchNo)}&expiry_date=${data.expiryDate}`,
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
