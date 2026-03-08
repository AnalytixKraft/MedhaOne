import type { Page } from "@playwright/test";

import type { WorkflowContext, WorkflowDefinition } from "../engine.ts";

async function isPurchaseComplete(page: Page, context: WorkflowContext): Promise<boolean> {
  if (/\/purchase\/grn\/\d+(?:\/|$)/.test(page.url())) {
    const bodyText = (await page.textContent("body")) ?? "";
    if (/status:\s*posted/i.test(bodyText) && /stock qty:/i.test(bodyText)) {
      return true;
    }
  }

  const poResponse = await page.request.get("/api/purchase/po");
  const grnResponse = await page.request.get("/api/purchase/grn");
  if (!poResponse.ok() || !grnResponse.ok()) {
    return false;
  }

  const poData = (await poResponse.json()) as {
    items?: Array<{ status?: string; supplier_id?: number }>;
  };
  const grns = (await grnResponse.json()) as Array<{ status?: string }>;

  if (!poData.items?.some((po) => po.status === "CLOSED")) {
    return false;
  }

  if (!grns.some((grn) => grn.status === "POSTED")) {
    return false;
  }

  const params = new URLSearchParams({
    warehouse_code: context.generatedData.warehouseCode,
    product_sku: context.generatedData.productSku,
    batch_no: context.generatedData.batchNo,
    expiry_date: context.generatedData.expiryDate,
  });
  const stockResponse = await page.request.get(`/api/test/stock-summary?${params.toString()}`);
  if (!stockResponse.ok()) {
    return false;
  }
  const stock = (await stockResponse.json()) as { qty_on_hand?: string };
  return Number(stock.qty_on_hand ?? "0") > 0;
}

export const purchaseWorkflow: WorkflowDefinition = {
  name: "purchase",
  entryPath: "/login",
  allowedPathPrefixes: [
    "/login",
    "/dashboard",
    "/masters",
    "/masters/parties",
    "/masters/products",
    "/masters/warehouses",
    "/purchase",
    "/purchase/po",
    "/purchase/grn",
  ],
  allowsDestructiveActions: false,
  requiredInvariants: ["within_scope", "no_app_errors", "stock_non_negative"],
  goalSummary:
    "Complete the full PO to GRN to posted stock flow with deterministic test data and verify stock increased.",
  buildGuidance: (context: WorkflowContext) => [
    "Login with e2e.admin@medhaone.app / ChangeMe123! if you are not authenticated.",
    "Create missing master data first.",
    `Supplier name: '${context.generatedData.supplierName}'.`,
    `Warehouse name: '${context.generatedData.warehouseName}', code '${context.generatedData.warehouseCode}'.`,
    `Product SKU: '${context.generatedData.productSku}', product name '${context.generatedData.productName}'.`,
    "Create a purchase order for quantity 10, approve it, create a GRN for quantity 10, and post the GRN.",
    `Use batch '${context.generatedData.batchNo}' with expiry '${context.generatedData.expiryDate}'.`,
    "Stop only after the PO is CLOSED and stock is visible.",
  ],
  isComplete: isPurchaseComplete,
};
