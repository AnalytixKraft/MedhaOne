import type { Page } from "@playwright/test";

import type { WorkflowContext, WorkflowDefinition } from "../engine.ts";

async function isOrgE2eComplete(page: Page, context: WorkflowContext): Promise<boolean> {
  const onReport = /\/reports\/stock-inward(?:\/|$)/.test(page.url());
  if (!onReport) {
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
    const bodyText = (await page.textContent("body")) ?? "";
    return /stock inward report/i.test(bodyText);
  }

  const stock = (await stockResponse.json()) as { qty_on_hand?: string };
  return Number(stock.qty_on_hand ?? "0") > 0;
}

export const orgE2eWorkflow: WorkflowDefinition = {
  name: "org_e2e",
  entryPath: "/rbac/login",
  allowedPathPrefixes: [
    "/rbac/login",
    "/rbac/super-admin",
    "/rbac/super-admin/organizations",
    "/rbac/org-admin",
    "/login",
    "/dashboard",
    "/masters",
    "/masters/parties",
    "/masters/products",
    "/masters/warehouses",
    "/purchase",
    "/purchase/po",
    "/purchase/grn",
    "/inventory",
    "/warehouse",
    "/reports",
    "/reports/stock-inward",
  ],
  allowsDestructiveActions: false,
  requiredInvariants: [
    "within_scope",
    "no_app_errors",
    "stock_non_negative",
    "tenant_identity_matches",
  ],
  goalSummary:
    "Provision a tenant, sign in as the org admin, create master data, complete the PO to GRN flow, review the Inventory module, and then land on the Stock Inward report with posted stock visible.",
  buildGuidance: (context: WorkflowContext) => [
    "Start at the RBAC login page.",
    "First sign in as the seeded super admin: superadmin@medhaone.app / ChangeThisImmediately! with the organization field left blank.",
    "Open Organizations and click 'Create Organization'.",
    `Create the organization with slug '${context.organization.id}' and name '${context.organization.name}'.`,
    `Use admin name '${context.organization.adminFullName}', admin email '${context.organization.adminEmail}', admin password '${context.organization.adminPassword}', and max users ${context.organization.maxUsers}.`,
    "After the organization is created, leave the super admin flow and continue through the main ERP login.",
    `Go to /login and sign in with '${context.organization.adminEmail}' and password '${context.organization.adminPassword}'.`,
    `If the ERP login asks you to choose an organization, select '${context.organization.id}'.`,
    `Confirm the ERP tenant identity is '${context.organization.name}' via organization context, not by trusting any prefilled company branding.`,
    "After you land on the ERP dashboard, follow this exact order: create supplier (party), create warehouse, create product, raise a PO, approve it, create a GRN, post the GRN, review Inventory, then open Reports.",
    `Create supplier '${context.generatedData.supplierName}' in Masters > Parties.`,
    `Create warehouse '${context.generatedData.warehouseName}' with code '${context.generatedData.warehouseCode}' in Masters > Warehouses.`,
    `Create product '${context.generatedData.productSku}' / '${context.generatedData.productName}' in Masters > Products.`,
    `In Purchase, create a PO for quantity 10, approve it, create a GRN for quantity 10, and post it using batch '${context.generatedData.batchNo}' with expiry '${context.generatedData.expiryDate}'.`,
    "After the GRN is posted, open the Inventory module and review the inventory landing page before going to Reports.",
    "Only after the Inventory step, open Reports and then open the Stock Inward report so the run ends on a reporting view.",
  ],
  isComplete: isOrgE2eComplete,
};
