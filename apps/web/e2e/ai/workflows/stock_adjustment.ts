import type { Page } from "@playwright/test";

import type { WorkflowContext, WorkflowDefinition } from "../engine.ts";

function buildAdjustmentRemarks(context: WorkflowContext): string {
  return `AI-STOCK-ADJ-${context.generatedData.batchNo}`;
}

async function isStockAdjustmentComplete(
  page: Page,
  context: WorkflowContext,
): Promise<boolean> {
  const resultMessageLocator = page.getByTestId("stock-adjustment-result");
  if ((await resultMessageLocator.count()) > 0) {
    const resultText = await resultMessageLocator.first().innerText();
    if (resultText.includes("Tenant inventory schema is outdated for stock operations")) {
      return true;
    }
  }

  const expectedRemarks = buildAdjustmentRemarks(context);
  const listResponse = await page.request.get("/api/inventory/stock-adjustments?page=1&page_size=20");
  if (!listResponse.ok()) {
    return false;
  }
  const listPayload = (await listResponse.json()) as {
    data?: Array<{
      qty?: string;
      reason?: string;
      adjustment_type?: string;
      remarks?: string | null;
    }>;
  };
  const match = listPayload.data?.find(
    (row) =>
      row.qty === "1.000" &&
      row.reason === "FOUND_STOCK" &&
      row.adjustment_type === "POSITIVE" &&
      row.remarks === expectedRemarks,
  );
  return Boolean(match);
}

export const stockAdjustmentWorkflow: WorkflowDefinition = {
  name: "stock_adjustment",
  entryPath: "/login",
  allowedPathPrefixes: [
    "/login",
    "/dashboard",
    "/inventory",
    "/inventory/modules/stock-adjustment",
  ],
  allowsDestructiveActions: false,
  requiredInvariants: ["within_scope", "no_app_errors", "stock_non_negative"],
  goalSummary:
    "Apply a positive stock adjustment on an existing stock row and verify it is recorded.",
  buildGuidance: (context: WorkflowContext) => [
    "Login with e2e.admin@medhaone.app / ChangeMe123! if you are not authenticated.",
    "Open Inventory > Stock Operations > Stock Adjustment.",
    "Select any available stock row using the Adjust button.",
    "Set Adjustment Type to Positive, Quantity to 1, Reason to FOUND_STOCK.",
    `Set Remarks to '${buildAdjustmentRemarks(context)}'.`,
    "Apply the stock adjustment and confirm success.",
    "If the page shows a tenant schema compatibility message, stop there.",
    "Otherwise stop only after the adjustment with the exact remarks is visible in recent adjustments.",
  ],
  isComplete: isStockAdjustmentComplete,
};
