import type { Page } from "@playwright/test";

import type { DomSummary } from "../dom-extractor.ts";
import type { WorkflowContext, WorkflowDefinition } from "../engine.ts";

export type InvariantName =
  | "within_scope"
  | "no_app_errors"
  | "stock_non_negative"
  | "tenant_identity_matches";

function isAllowedPath(pathname: string, workflow: WorkflowDefinition): boolean {
  return workflow.allowedPathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function checkStockNonNegative(page: Page, context: WorkflowContext): Promise<string | null> {
  const params = new URLSearchParams({
    warehouse_code: context.generatedData.warehouseCode,
    product_sku: context.generatedData.productSku,
    batch_no: context.generatedData.batchNo,
    expiry_date: context.generatedData.expiryDate,
  });

  const response = await page.request.get(`/api/test/stock-summary?${params.toString()}`);
  if (response.status() === 404) {
    return null;
  }
  if (!response.ok()) {
    return `Stock summary lookup failed with ${response.status()}`;
  }

  const payload = (await response.json()) as { qty_on_hand?: string };
  const qty = Number(payload.qty_on_hand ?? "0");
  if (!Number.isFinite(qty) || qty < 0) {
    return `Stock summary returned invalid quantity '${payload.qty_on_hand ?? "unknown"}'`;
  }

  return null;
}

async function checkTenantIdentityMatches(
  page: Page,
  domSummary: DomSummary,
  workflow: WorkflowDefinition,
  context: WorkflowContext,
): Promise<string | null> {
  if (workflow.name !== "org_e2e") {
    return null;
  }

  const currentPath = new URL(domSummary.currentUrl).pathname;
  const inErpApp =
    currentPath === "/dashboard" ||
    currentPath.startsWith("/masters") ||
    currentPath.startsWith("/purchase") ||
    currentPath.startsWith("/reports") ||
    currentPath.startsWith("/settings") ||
    currentPath.startsWith("/inventory") ||
    currentPath.startsWith("/users");

  if (!inErpApp) {
    return null;
  }

  const response = await page.request.get("/api/settings/company");
  if (response.status() === 401 || response.status() === 403) {
    return null;
  }
  if (!response.ok()) {
    return `Company settings lookup failed with ${response.status()}`;
  }

  const payload = (await response.json()) as { organization_name?: string | null };
  const actualName = typeof payload.organization_name === "string" ? payload.organization_name.trim() : "";
  if (actualName !== context.organization.name) {
    return `Tenant identity mismatch: expected organization '${context.organization.name}' but received '${actualName || "unknown"}'`;
  }

  return null;
}

export async function runInvariants(
  page: Page,
  domSummary: DomSummary,
  workflow: WorkflowDefinition,
  context: WorkflowContext,
): Promise<string[]> {
  const failures: string[] = [];
  const currentPath = new URL(domSummary.currentUrl).pathname;

  for (const invariant of workflow.requiredInvariants) {
    if (invariant === "within_scope" && !isAllowedPath(currentPath, workflow)) {
      failures.push(`Current path '${currentPath}' is outside the workflow scope`);
    }

    if (invariant === "no_app_errors") {
      const criticalText = domSummary.visibleText.join(" ");
      if (/Unhandled Runtime Error|Something went wrong|Failed to load|Tenant authentication service is unavailable/i.test(criticalText)) {
        failures.push("The page shows a critical application error");
      }
    }

    if (invariant === "stock_non_negative") {
      const stockFailure = await checkStockNonNegative(page, context);
      if (stockFailure) {
        failures.push(stockFailure);
      }
    }

    if (invariant === "tenant_identity_matches") {
      const tenantFailure = await checkTenantIdentityMatches(page, domSummary, workflow, context);
      if (tenantFailure) {
        failures.push(tenantFailure);
      }
    }
  }

  return failures;
}
