import type { Page } from "@playwright/test";

import type { WorkflowContext, WorkflowDefinition } from "../engine.ts";

async function checkMastersCreated(page: Page, context: WorkflowContext): Promise<boolean> {
  const partiesResponse = await page.request.get("/api/masters/parties");
  const productsResponse = await page.request.get("/api/masters/products");
  if (!partiesResponse.ok() || !productsResponse.ok()) {
    return false;
  }

  const parties = (await partiesResponse.json()) as Array<{ name?: string }>;
  const products = (await productsResponse.json()) as Array<{ sku?: string }>;

  return (
    parties.some((party) => party.name === context.generatedData.supplierName) &&
    products.some((product) => product.sku === context.generatedData.productSku)
  );
}

export const mastersWorkflow: WorkflowDefinition = {
  name: "masters",
  entryPath: "/login",
  allowedPathPrefixes: [
    "/login",
    "/dashboard",
    "/masters",
    "/masters/parties",
    "/masters/products",
  ],
  allowsDestructiveActions: false,
  requiredInvariants: ["within_scope", "no_app_errors"],
  goalSummary:
    "Login, create one supplier and one product using the provided dataset, and verify both exist.",
  buildGuidance: (context: WorkflowContext) => [
    "Login with admin@medhaone.app / ChangeMe123! if you are not authenticated.",
    "Navigate to Masters.",
    `Create a supplier named '${context.generatedData.supplierName}' with type SUPER_STOCKIST.`,
    `Create a product with SKU '${context.generatedData.productSku}' and name '${context.generatedData.productName}'.`,
    "You do not need to create warehouses for this workflow.",
  ],
  isComplete: checkMastersCreated,
};
