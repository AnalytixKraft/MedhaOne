import { expect, Page, test } from "@playwright/test";

import { resetAndSeed } from "../utils/api";
import { loginAsAdmin } from "../utils/auth";
import { selectErpComboboxOption } from "../utils/erpCombobox";
import { GeneratedData, generateData } from "../utils/testData";

type GstSetup = {
  companyGstin?: string | null;
  companyState?: string | null;
  supplierGstin?: string | null;
  supplierState?: string | null;
};

type GstContext = {
  companyGstin: string | null;
  supplierGstin: string | null;
};

function buildUniqueGstin(stateCode: string): string {
  const serial = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    .slice(-4)
    .padStart(4, "0");
  const suffixDigit = `${Math.floor(Math.random() * 10)}`;
  return `${stateCode}AKERP${serial}F1Z${suffixDigit}`;
}

async function createMasters(
  page: Page,
  data: GeneratedData,
  gstSetup: GstSetup = {},
): Promise<GstContext> {
  const companyStateCode =
    gstSetup.companyGstin?.slice(0, 2) ??
    (gstSetup.companyState === "Karnataka" ? "29" : "27");
  const supplierStateCode =
    gstSetup.supplierGstin?.slice(0, 2) ??
    (gstSetup.supplierState === "Karnataka" ? "29" : "27");
  const companyGstin =
    gstSetup.companyGstin === null
      ? null
      : gstSetup.companyGstin ?? buildUniqueGstin(companyStateCode);
  const supplierGstin =
    gstSetup.supplierGstin ?? buildUniqueGstin(supplierStateCode);

  const companyResponse = await page.request.patch("/api/settings/company", {
    data: {
      company_name: "E2E Isolated Workspace",
      gst_number: companyGstin,
      state: gstSetup.companyState ?? "Maharashtra",
    },
  });
  expect(companyResponse.ok()).toBeTruthy();

  const supplierResponse = await page.request.post("/api/masters/parties", {
    data: {
      name: data.supplierName,
      party_type: "SUPPLIER",
      party_category: "STOCKIST",
      state: gstSetup.supplierState ?? "Maharashtra",
      gstin: supplierGstin,
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

  return {
    companyGstin,
    supplierGstin,
  };
}

async function createProductMaster(
  page: Page,
  {
    sku,
    name,
    gstRate,
  }: {
    sku: string;
    name: string;
    gstRate: string;
  },
): Promise<void> {
  const productResponse = await page.request.post("/api/masters/products", {
    data: {
      sku,
      name,
      uom: "EA",
      gst_rate: gstRate,
      is_active: true,
    },
  });
  expect(productResponse.ok()).toBeTruthy();
}

async function openPoForm(page: Page, data: GeneratedData): Promise<void> {
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
    `${data.productName} (12%)`,
    data.productName,
  );
}

async function openPoFormWithoutSupplier(page: Page, data: GeneratedData): Promise<void> {
  await page.goto("/purchase/po");
  await selectErpComboboxOption(
    page,
    "po-warehouse-select",
    data.warehouseName,
    data.warehouseName,
  );
  await selectErpComboboxOption(
    page,
    "po-line-product-0",
    `${data.productName} (12%)`,
    data.productName,
  );
}

test.beforeEach(async ({ request }) => {
  await resetAndSeed(request, false);
});

test("same-state supplier shows per-line CGST/SGST and rolled-up total", async ({
  page,
}) => {
  const data = generateData("POTAXINTRA");
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyState: "Maharashtra",
    supplierState: "Maharashtra",
  });

  await openPoForm(page, data);
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-line-gst-0")).toHaveText("12.00%");
  await expect(page.getByTestId("po-line-tax-0")).toHaveText("120.00");
  await expect(page.getByTestId("po-line-total-0")).toHaveText("1,120.00");
  await expect(page.getByTestId("po-summary-taxable-value")).toContainText("1,000.00");
  await expect(page.getByTestId("po-summary-cgst")).toContainText("60.00");
  await expect(page.getByTestId("po-summary-sgst")).toContainText("60.00");
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");
});

test("different-state supplier shows IGST per line and in summary", async ({
  page,
}) => {
  const data = generateData("POTAXINTER");
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyState: "Maharashtra",
    supplierState: "Karnataka",
  });

  await openPoForm(page, data);
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-line-gst-0")).toHaveText("12.00%");
  await expect(page.getByTestId("po-line-tax-0")).toHaveText("120.00");
  await expect(page.getByTestId("po-line-total-0")).toHaveText("1,120.00");
  await expect(page.getByTestId("po-summary-cgst")).toContainText("0.00");
  await expect(page.getByTestId("po-summary-sgst")).toContainText("0.00");
  await expect(page.getByTestId("po-summary-igst")).toContainText("120.00");
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");
});

test("missing company GST shows structured warning and blocks save", async ({
  page,
}) => {
  const data = generateData("POTAXWARN");
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyGstin: null,
    companyState: "Maharashtra",
    supplierState: "Maharashtra",
  });

  await openPoForm(page, data);
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-tax-warning")).toContainText(
    "Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.",
  );
  await expect(page.getByTestId("po-tax-validation")).toContainText(
    "Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.",
  );
  await expect(page.getByTestId("create-po")).toBeDisabled();
});

test("purchase order save succeeds with GST-inclusive totals", async ({ page }) => {
  const data = generateData("POTAXSAVE");
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyState: "Maharashtra",
    supplierState: "Maharashtra",
  });

  await openPoForm(page, data);
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/purchase-orders"),
  );
  await page.getByTestId("create-po").click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId("po-line-total-0")).toHaveText("0.00");
});

test("tax amount is shown even before supplier tax context is determined", async ({
  page,
}) => {
  const data = generateData("POTAXNOSUP");
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyState: "Maharashtra",
    supplierState: "Maharashtra",
  });

  await openPoFormWithoutSupplier(page, data);
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-line-gst-0")).toHaveText("12.00%");
  await expect(page.getByTestId("po-line-tax-0")).toHaveText("120.00");
  await expect(page.getByTestId("po-line-total-0")).toHaveText("1,120.00");
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");
});

test("selecting supplier after line entry recalculates totals immediately", async ({
  page,
}) => {
  const data = generateData("POTAXLATE");
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyState: "Maharashtra",
    supplierState: "Maharashtra",
  });

  await openPoFormWithoutSupplier(page, data);
  await page.getByTestId("po-line-qty-0").fill("10");
  await page.getByTestId("po-line-cost-0").fill("100");

  await expect(page.getByTestId("po-line-tax-0")).toHaveText("120.00");
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");

  await selectErpComboboxOption(
    page,
    "po-supplier-select",
    data.supplierName,
    data.supplierName,
  );

  await expect(page.getByTestId("po-line-tax-0")).toHaveText("120.00");
  await expect(page.getByTestId("po-line-total-0")).toHaveText("1,120.00");
  await expect(page.getByTestId("po-summary-cgst")).toContainText("60.00");
  await expect(page.getByTestId("po-summary-sgst")).toContainText("60.00");
  await expect(page.getByTestId("po-final-total")).toHaveText("1,120.00");
});

test("mixed GST slab products roll summary totals correctly for same-state supplier", async ({
  page,
}) => {
  const data = generateData("POTAXMIX");
  const secondSku = `${data.productSku}-18`;
  const secondName = `${data.productName} 18`;
  await loginAsAdmin(page);
  await createMasters(page, data, {
    companyState: "Maharashtra",
    supplierState: "Maharashtra",
  });
  await createProductMaster(page, {
    sku: secondSku,
    name: secondName,
    gstRate: "18.00",
  });

  await openPoForm(page, data);
  await page.getByTestId("po-line-qty-0").fill("1000");
  await page.getByTestId("po-line-cost-0").fill("23");
  await page.getByText("Add Row").click();
  await selectErpComboboxOption(
    page,
    "po-line-product-1",
    `${secondName} (18%)`,
    secondName,
  );
  await page.getByTestId("po-line-qty-1").fill("1000");
  await page.getByTestId("po-line-cost-1").fill("93");

  await expect(page.getByTestId("po-line-tax-0")).toHaveText("2,760.00");
  await expect(page.getByTestId("po-line-total-0")).toHaveText("25,760.00");
  await expect(page.getByTestId("po-line-tax-1")).toHaveText("16,740.00");
  await expect(page.getByTestId("po-line-total-1")).toHaveText("1,09,740.00");
  await expect(page.getByTestId("po-summary-taxable-value")).toContainText("1,16,000.00");
  await expect(page.getByTestId("po-summary-cgst")).toContainText("9,750.00");
  await expect(page.getByTestId("po-summary-sgst")).toContainText("9,750.00");
  await expect(page.getByTestId("po-summary-igst")).toContainText("0.00");
  await expect(page.getByTestId("po-final-total")).toHaveText("1,35,500.00");
});
