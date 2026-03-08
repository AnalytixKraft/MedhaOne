import fs from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { config, type AiWorkflowName } from "./config.ts";
import { extractDomSummary, type DomSummary } from "./dom-extractor.ts";
import {
  captureDiagnosticScreenshot,
  executeAction,
  type StepExecution,
} from "./executor.ts";
import { requestPlannerAction, InvalidPlannerOutputError } from "./openai-client.ts";
import {
  runInvariants,
  type InvariantName,
} from "./validators/invariants.ts";
import {
  validateAction,
  InvalidActionError,
  type AiAction,
} from "./validators/action-schema.ts";
import { loginWorkflow } from "./workflows/login.ts";
import { mastersWorkflow } from "./workflows/masters.ts";
import { orgE2eWorkflow } from "./workflows/org_e2e.ts";
import { purchaseWorkflow } from "./workflows/purchase.ts";
import { stockAdjustmentWorkflow } from "./workflows/stock_adjustment.ts";
import { generateData, type GeneratedData } from "./data.ts";

export type WorkflowContext = {
  runId: string;
  generatedData: GeneratedData;
  organization: {
    id: string;
    name: string;
    adminFullName: string;
    adminEmail: string;
    adminPassword: string;
    maxUsers: number;
  };
};

export type WorkflowDefinition = {
  name: AiWorkflowName;
  entryPath: string;
  allowedPathPrefixes: string[];
  allowsDestructiveActions: boolean;
  requiredInvariants: InvariantName[];
  goalSummary: string;
  buildGuidance: (context: WorkflowContext) => string[];
  isComplete: (page: Page, context: WorkflowContext) => Promise<boolean>;
};

type StepRecord = {
  step: number;
  action?: AiAction;
  success: boolean;
  error?: string;
  screenshotPath?: string;
};

export type EngineResult = {
  success: boolean;
  stopReason:
    | "workflow_complete"
    | "step_limit_reached"
    | "no_progress_limit"
    | "invalid_output_limit"
    | "invariant_failure"
    | "fatal_error";
  reportPath: string;
  steps: StepRecord[];
};

type RbacOrganizationRecord = {
  id: string;
  name: string;
};

const RBAC_SESSION_STORAGE_KEY = "medhaone-rbac-session";
const STANDARD_E2E_EMAIL = process.env.E2E_USER_EMAIL?.trim() || "e2e.admin@medhaone.app";
const STANDARD_E2E_PASSWORD = process.env.E2E_USER_PASSWORD?.trim() || "ChangeMe123!";

const WORKFLOWS: Record<AiWorkflowName, WorkflowDefinition> = {
  login: loginWorkflow,
  masters: mastersWorkflow,
  purchase: purchaseWorkflow,
  stock_adjustment: stockAdjustmentWorkflow,
  org_e2e: orgE2eWorkflow,
};

function isLoginTarget(target: string, ...patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(target));
}

function isAuthPageUrl(url: string): boolean {
  return isRbacLoginUrl(url) || isErpLoginUrl(url);
}

function isRbacLoginUrl(url: string): boolean {
  return /\/rbac\/login(?:\/|$)/.test(url);
}

function isErpLoginUrl(url: string): boolean {
  return /\/login(?:\/|$)/.test(url) && !isRbacLoginUrl(url);
}

function getWorkflowPhase(
  workflow: WorkflowDefinition,
  history: string[],
  domSummary: DomSummary,
): "super_admin_login" | "org_admin_login" | "organization_setup" | "org_created" | "general" {
  if (workflow.name !== "org_e2e") {
    return "general";
  }

  const createdOrganization = history.some((line) => line.includes("ORG_CREATED_VERIFIED"));

  if (createdOrganization && /\/rbac\/super-admin(?:\/|$)/.test(domSummary.currentUrl)) {
    return "org_created";
  }

  if (isRbacLoginUrl(domSummary.currentUrl)) {
    return createdOrganization ? "org_admin_login" : "super_admin_login";
  }

  if (createdOrganization && isErpLoginUrl(domSummary.currentUrl)) {
    return "org_admin_login";
  }

  if (/\/rbac\/super-admin\/organizations(?:\/|$)/.test(domSummary.currentUrl)) {
    return "organization_setup";
  }

  return "general";
}

function inferPlannerValue(
  workflow: WorkflowDefinition,
  context: WorkflowContext,
  domSummary: DomSummary,
  history: string[],
  target: string,
): string | undefined {
  if (workflow.name === "login") {
    if (isLoginTarget(target, /\bemail\b/i, /login-email/i)) {
      return STANDARD_E2E_EMAIL;
    }
    if (isLoginTarget(target, /\bpassword\b/i, /login-password/i)) {
      return STANDARD_E2E_PASSWORD;
    }
    return undefined;
  }

  if (workflow.name !== "org_e2e") {
    return undefined;
  }

  const phase = getWorkflowPhase(workflow, history, domSummary);
  const onRbacLogin = isRbacLoginUrl(domSummary.currentUrl);
  const onErpLogin = isErpLoginUrl(domSummary.currentUrl);
  const onLoginForm =
    phase === "super_admin_login" || (phase === "org_admin_login" && (onRbacLogin || onErpLogin));
  if (onLoginForm) {
    if (isLoginTarget(target, /\bemail\b/i)) {
      return phase === "org_admin_login" ? context.organization.adminEmail : "superadmin@medhaone.app";
    }
    if (isLoginTarget(target, /\bpassword\b/i)) {
      return phase === "org_admin_login" ? context.organization.adminPassword : "ChangeThisImmediately!";
    }
    if (
      phase === "org_admin_login" &&
      onRbacLogin &&
      isLoginTarget(target, /organization/i, /\bslug\b/i)
    ) {
      return context.organization.id;
    }
    if (phase === "org_admin_login" && onErpLogin && isLoginTarget(target, /^organization$/i)) {
      return context.organization.id;
    }
  }

  if (/\/rbac\/super-admin(?:\/|$)/.test(domSummary.currentUrl)) {
    if (/organization name/i.test(target)) {
      return context.organization.name;
    }
    if (/^(slug|organization id)$/i.test(target) || /\bslug\b/i.test(target)) {
      return context.organization.id;
    }
    if (/max users/i.test(target)) {
      return String(context.organization.maxUsers);
    }
    if (/admin name/i.test(target)) {
      return context.organization.adminFullName;
    }
    if (/admin email/i.test(target)) {
      return context.organization.adminEmail;
    }
    if (/admin password/i.test(target)) {
      return context.organization.adminPassword;
    }
  }

  if (/\/masters\/parties(?:\/|$)/.test(domSummary.currentUrl)) {
    if (/party-name/i.test(target)) {
      return context.generatedData.supplierName;
    }
    if (/^phone$/i.test(target)) {
      return "9876543210";
    }
    if (/^email$/i.test(target)) {
      return `supplier.${context.runId.replace(/[^0-9]/g, "").slice(-6)}@medhaone.app`;
    }
    if (/^address$/i.test(target)) {
      return "AI Test Party Address";
    }
  }

  if (/\/masters\/warehouses(?:\/|$)/.test(domSummary.currentUrl)) {
    if (/warehouse-name/i.test(target)) {
      return context.generatedData.warehouseName;
    }
    if (/warehouse-code/i.test(target)) {
      return context.generatedData.warehouseCode;
    }
    if (/^address$/i.test(target)) {
      return "AI Test Warehouse Address";
    }
  }

  if (/\/masters\/products(?:\/|$)/.test(domSummary.currentUrl)) {
    if (/product-sku/i.test(target) || /^sku$/i.test(target)) {
      return context.generatedData.productSku;
    }
    if (/product-name/i.test(target) || /^product name$/i.test(target)) {
      return context.generatedData.productName;
    }
    if (/^uom$/i.test(target)) {
      return "PCS";
    }
    if (/^brand$/i.test(target)) {
      return "AI Brand";
    }
    if (/^hsn$/i.test(target)) {
      return "3004";
    }
    if (/^gst rate$/i.test(target)) {
      return "12";
    }
  }

  return undefined;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function selectValueKey(payload: Record<string, unknown>): string {
  for (const key of ["value", "input", "text", "option"]) {
    if (key in payload) {
      return key;
    }
  }
  return "value";
}

function repairPlannerAction(
  rawAction: unknown,
  workflow: WorkflowDefinition,
  context: WorkflowContext,
  domSummary: DomSummary,
  history: string[],
): unknown {
  const payload = asRecord(rawAction);
  if (!payload) {
    return rawAction;
  }

  const candidate =
    asRecord(payload.next_action) ??
    asRecord(payload.nextAction) ??
    asRecord(payload.step) ??
    asRecord(payload.command) ??
    (Array.isArray(payload.plan) ? asRecord(payload.plan[0]) : null) ??
    payload;

  const action = firstString(candidate, ["action", "type", "tool", "command"]);
  if (!action || !/^(type|fill|input|enter|type_text|fill_field|select|choose|pick|select_option)$/i.test(action)) {
    return rawAction;
  }

  const currentValue = firstString(candidate, ["value", "input", "text", "option"]);
  if (currentValue) {
    return rawAction;
  }

  const target = firstString(candidate, ["target", "element", "selector", "field"]);
  if (!target) {
    return rawAction;
  }

  const inferredValue = inferPlannerValue(workflow, context, domSummary, history, target);
  if (!inferredValue) {
    return rawAction;
  }

  candidate[selectValueKey(candidate)] = inferredValue;
  if (!firstString(candidate, ["reason", "explanation", "why"])) {
    candidate.reason = `Auto-filled deterministic value for '${target}'.`;
  }

  return rawAction;
}

function buildRuntimeHints(
  workflow: WorkflowDefinition,
  context: WorkflowContext,
  domSummary: DomSummary,
  history: string[],
): string[] {
  const hints: string[] = [];
  const phase = getWorkflowPhase(workflow, history, domSummary);

  if (domSummary.buttons.some((button) => /signing in|loading|saving|processing|please wait/i.test(button.target))) {
    hints.push("Ignore loading-state buttons such as 'Signing in...'. They are not valid click targets.");
  }

  if (workflow.name === "org_e2e" && phase === "org_admin_login") {
    if (isErpLoginUrl(domSummary.currentUrl)) {
      hints.push(
        `You are on the main ERP login form. Fill Email='${context.organization.adminEmail}' and Password='${context.organization.adminPassword}', then click Sign in once.`,
      );
      hints.push(
        `If an Organization selector appears after sign-in, choose '${context.organization.id}' and submit again.`,
      );
      hints.push(
        "Only choose an organization if the selector is visible in the DOM summary. If it is not visible, wait for the dashboard instead of inventing the selector.",
      );
    } else {
      hints.push(
        "Do not continue on the RBAC login page for the org admin. The org admin must use the main ERP login.",
      );
      hints.push("Move to /login, then sign in as the org admin there.");
    }
  } else if (workflow.name === "org_e2e" && phase === "org_created") {
    hints.push(
      "The organization has already been created. Do not open the create-organization flow again.",
    );
    hints.push(
      "Do not keep navigating inside the super-admin UI. Continue on the main ERP login at /login.",
    );
  } else if (workflow.name === "org_e2e" && phase === "super_admin_login") {
    hints.push(
      "You are on the super-admin login form. Fill Email='superadmin@medhaone.app' and Password='ChangeThisImmediately!', leave the organization slug blank, then click Sign in once.",
    );
  }

  if (workflow.name === "org_e2e" && phase === "organization_setup") {
    hints.push(
      `If the create-organization form is open, use Organization Name='${context.organization.name}', Slug='${context.organization.id}', Max Users='${context.organization.maxUsers}', Admin Name='${context.organization.adminFullName}', Admin Email='${context.organization.adminEmail}', Admin Password='${context.organization.adminPassword}'.`,
    );
  }

  if (workflow.name === "org_e2e" && !hasHistoryMarker(history, "INVENTORY_REVIEWED")) {
    hints.push(
      "Do not open Reports yet. First complete master data, complete the purchase flow through posted GRN, then open the Inventory module.",
    );
    hints.push(
      "The workflow order is strict: Parties -> Warehouses -> Products -> Purchase Order -> GRN -> Inventory -> Reports.",
    );
  }

  if (workflow.name === "org_e2e") {
    if (!hasHistoryMarker(history, "PARTY_CREATED")) {
      hints.push(
        `The supplier is not created yet. Stay in Masters and create supplier '${context.generatedData.supplierName}' before moving on.`,
      );
    } else if (!hasHistoryMarker(history, "WAREHOUSE_CREATED")) {
      hints.push(
        `The warehouse is not created yet. Stay in Masters and create warehouse '${context.generatedData.warehouseName}' / '${context.generatedData.warehouseCode}' before moving on.`,
      );
    } else if (!hasHistoryMarker(history, "PRODUCT_CREATED")) {
      hints.push(
        `The product is not created yet. Stay in Masters and create product '${context.generatedData.productSku}' / '${context.generatedData.productName}' before moving on.`,
      );
      if (/\/masters\/products(?:\/|$)/.test(domSummary.currentUrl)) {
        hints.push(
          "On the product form, fill Product SKU, Product Name, and UOM='PCS'. UOM is required. After that, click create-product once.",
        );
        hints.push(
          "Do not keep retyping Product SKU and Product Name if they are already filled. Fill UOM next, then submit the form.",
        );
      }
    } else if (!hasHistoryMarker(history, "PURCHASE_POSTED")) {
      hints.push(
        "Master data is complete. Move to Purchase now, create the PO, approve it, create the GRN, and post the GRN before opening Inventory.",
      );
    } else if (!hasHistoryMarker(history, "INVENTORY_REVIEWED")) {
      hints.push(
        "The purchase flow is complete. Open the Inventory module now and review it before opening Reports.",
      );
    }
  }

  return hints;
}

function nowTag(): string {
  const value = new Date();
  const pad = (num: number) => `${num}`.padStart(2, "0");
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(
    value.getHours(),
  )}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

function buildContext(): WorkflowContext {
  const runId = nowTag();
  const generatedData = generateData(config.workflow.toUpperCase().slice(0, 3));
  const suffix = runId.replace(/[^0-9]/g, "").slice(-10);
  return {
    runId,
    generatedData,
    organization: {
      id: `ai_org_${suffix}`,
      name: `AI Org ${suffix}`,
      adminFullName: `AI Org Admin ${suffix}`,
      adminEmail: `orgadmin.${suffix}@medhaone.app`,
      adminPassword: "ChangeThisImmediately!",
      maxUsers: config.orgMaxUsers,
    },
  };
}

function hasHistoryMarker(history: string[], marker: string): boolean {
  return history.includes(marker);
}

function domHasTarget(domSummary: DomSummary, target: string): boolean {
  return domSummary.targets.some((entry) => entry.target === target);
}

function firstTargetMatching(domSummary: DomSummary, pattern: RegExp): string | null {
  return domSummary.targets.find((entry) => pattern.test(entry.target))?.target ?? null;
}

async function syncWorkflowProgressMarkers(
  page: Page,
  context: WorkflowContext,
  history: string[],
): Promise<void> {
  if (!hasHistoryMarker(history, "PARTY_CREATED")) {
    const response = await page.request.get("/api/masters/parties");
    if (response.ok()) {
      const parties = (await response.json()) as Array<{ name?: string }>;
      if (parties.some((party) => party.name === context.generatedData.supplierName)) {
        history.push("PARTY_CREATED");
      }
    }
  }

  if (!hasHistoryMarker(history, "WAREHOUSE_CREATED")) {
    const response = await page.request.get("/api/masters/warehouses");
    if (response.ok()) {
      const warehouses = (await response.json()) as Array<{ code?: string }>;
      if (warehouses.some((warehouse) => warehouse.code === context.generatedData.warehouseCode)) {
        history.push("WAREHOUSE_CREATED");
      }
    }
  }

  if (!hasHistoryMarker(history, "PRODUCT_CREATED")) {
    const response = await page.request.get("/api/masters/products");
    if (response.ok()) {
      const products = (await response.json()) as Array<{ sku?: string }>;
      if (products.some((product) => product.sku === context.generatedData.productSku)) {
        history.push("PRODUCT_CREATED");
      }
    }
  }

  if (!hasHistoryMarker(history, "PURCHASE_POSTED")) {
    const poResponse = await page.request.get("/api/purchase/po");
    const grnResponse = await page.request.get("/api/purchase/grn");
    if (poResponse.ok() && grnResponse.ok()) {
      const poData = (await poResponse.json()) as { items?: Array<{ status?: string }> };
      const grns = (await grnResponse.json()) as Array<{ status?: string }>;
      if ((poData.items?.length ?? 0) > 0 && !hasHistoryMarker(history, "PO_CREATED")) {
        history.push("PO_CREATED");
      }
      if (
        (poData.items?.some((po) => po.status && po.status !== "DRAFT") ?? false) &&
        !hasHistoryMarker(history, "PO_APPROVED")
      ) {
        history.push("PO_APPROVED");
      }
      if (grns.length > 0 && !hasHistoryMarker(history, "GRN_CREATED")) {
        history.push("GRN_CREATED");
      }
      const poClosed = poData.items?.some((po) => po.status === "CLOSED") ?? false;
      const grnPosted = grns.some((grn) => grn.status === "POSTED");
      if (poClosed && grnPosted) {
        history.push("PURCHASE_POSTED");
      }
    }
  }

  if (!hasHistoryMarker(history, "STOCK_ADJUSTMENT_POSTED")) {
    const adjustmentResponse = await page.request.get("/api/inventory/stock-adjustments?page=1&page_size=20");
    if (adjustmentResponse.ok()) {
      const payload = (await adjustmentResponse.json()) as {
        data?: Array<{
          adjustment_type?: string;
          qty?: string;
          reason?: string;
          remarks?: string | null;
        }>;
      };
      const expectedRemarks = `AI-STOCK-ADJ-${context.generatedData.batchNo}`;
      if (
        payload.data?.some(
          (row) =>
            row.adjustment_type === "POSITIVE" &&
            row.qty === "1.000" &&
            row.reason === "FOUND_STOCK" &&
            row.remarks === expectedRemarks,
        )
      ) {
        history.push("STOCK_ADJUSTMENT_POSTED");
      }
    }
  }
}

function deterministicWorkflowAction(
  workflow: WorkflowDefinition,
  context: WorkflowContext,
  domSummary: DomSummary,
  history: string[],
): AiAction | null {
  if (
    ["login", "masters", "purchase", "stock_adjustment"].includes(workflow.name) &&
    isErpLoginUrl(domSummary.currentUrl)
  ) {
    if (
      domHasTarget(domSummary, "login-email") &&
      !hasHistoryMarker(history, "STANDARD_LOGIN_EMAIL_FILLED")
    ) {
      return {
        action: "type",
        target: "login-email",
        value: STANDARD_E2E_EMAIL,
        reason: "Entering the seeded admin email.",
      };
    }
    if (
      domHasTarget(domSummary, "login-password") &&
      !hasHistoryMarker(history, "STANDARD_LOGIN_PASSWORD_FILLED")
    ) {
      return {
        action: "type",
        target: "login-password",
        value: STANDARD_E2E_PASSWORD,
        reason: "Entering the seeded admin password.",
      };
    }
    if (
      domHasTarget(domSummary, "organization-selector") &&
      !hasHistoryMarker(history, "STANDARD_LOGIN_ORG_SELECTED")
    ) {
      return {
        action: "select",
        target: "organization-selector",
        value: "__first_non_empty__",
        reason: "Selecting the first available organization for the seeded admin account.",
      };
    }
    if (
      domHasTarget(domSummary, "login-submit") &&
      !hasHistoryMarker(history, "STANDARD_LOGIN_SUBMITTED")
    ) {
      return {
        action: "click",
        target: "login-submit",
        reason: "Submitting the ERP login form.",
      };
    }
    if (hasHistoryMarker(history, "STANDARD_LOGIN_SUBMITTED")) {
      return {
        action: "wait",
        target: "standard-auth-transition",
        value: "1000",
        reason: "Waiting for the ERP login transition to complete.",
      };
    }
  }

  if (workflow.name === "login") {
    return null;
  }

  const phase = getWorkflowPhase(workflow, history, domSummary);

  if (phase === "super_admin_login" && isRbacLoginUrl(domSummary.currentUrl)) {
    if (domHasTarget(domSummary, "Email") && !hasHistoryMarker(history, "SUPER_ADMIN_EMAIL_FILLED")) {
      return {
        action: "type",
        target: "Email",
        value: "superadmin@medhaone.app",
        reason: "Entering the super admin email.",
      };
    }
    if (domHasTarget(domSummary, "Password") && !hasHistoryMarker(history, "SUPER_ADMIN_PASSWORD_FILLED")) {
      return {
        action: "type",
        target: "Password",
        value: "ChangeThisImmediately!",
        reason: "Entering the super admin password.",
      };
    }
    if (domHasTarget(domSummary, "Sign in") && !hasHistoryMarker(history, "SUPER_ADMIN_LOGIN_SUBMITTED")) {
      return {
        action: "click",
        target: "Sign in",
        reason: "Submitting the super admin login form.",
      };
    }
    if (hasHistoryMarker(history, "SUPER_ADMIN_LOGIN_SUBMITTED")) {
      return {
        action: "wait",
        target: "super-admin-auth-transition",
        value: "1000",
        reason: "Waiting for the super admin login transition to complete.",
      };
    }
  }

  if (phase === "org_admin_login" && isErpLoginUrl(domSummary.currentUrl)) {
    if (
      domHasTarget(domSummary, "login-email") &&
      !hasHistoryMarker(history, "ORG_ADMIN_ERP_EMAIL_FILLED")
    ) {
      return {
        action: "type",
        target: "login-email",
        value: context.organization.adminEmail,
        reason: "Entering the org admin ERP email.",
      };
    }
    if (
      domHasTarget(domSummary, "login-password") &&
      !hasHistoryMarker(history, "ORG_ADMIN_ERP_PASSWORD_FILLED")
    ) {
      return {
        action: "type",
        target: "login-password",
        value: context.organization.adminPassword,
        reason: "Entering the org admin ERP password.",
      };
    }
    if (
      domHasTarget(domSummary, "organization-selector") &&
      !hasHistoryMarker(history, "ORG_ADMIN_ERP_ORG_SELECTED")
    ) {
      return {
        action: "select",
        target: "organization-selector",
        value: context.organization.id,
        reason: "Selecting the new organization for ERP login.",
      };
    }
    if (
      domHasTarget(domSummary, "login-submit") &&
      !hasHistoryMarker(history, "ORG_ADMIN_ERP_LOGIN_SUBMITTED")
    ) {
      return {
        action: "click",
        target: "login-submit",
        reason: "Submitting the org admin ERP login form.",
      };
    }
    if (hasHistoryMarker(history, "ORG_ADMIN_ERP_LOGIN_SUBMITTED")) {
      return {
        action: "wait",
        target: "erp-auth-transition",
        value: "1000",
        reason: "Waiting for the ERP login transition to complete.",
      };
    }
  }

  const needsWarehouse = workflow.name === "purchase" || workflow.name === "org_e2e";

  if (/\/dashboard(?:\/|$)/.test(domSummary.currentUrl)) {
    if (
      (
        workflow.name === "masters" ||
        workflow.name === "purchase"
      ) &&
      domHasTarget(domSummary, "nav-masters")
    ) {
      return {
        action: "click",
        target: "nav-masters",
        reason: "Opening Masters to continue the deterministic setup flow.",
      };
    }
  }

  if (/\/masters(?:\/|$)/.test(domSummary.currentUrl) && !/\/masters\/(parties|products|warehouses)(?:\/|$)/.test(domSummary.currentUrl)) {
    if (!hasHistoryMarker(history, "PARTY_CREATED") && domHasTarget(domSummary, "masters-parties-card")) {
      return {
        action: "click",
        target: "masters-parties-card",
        reason: "Opening Parties first in the deterministic masters flow.",
      };
    }
    if (needsWarehouse && !hasHistoryMarker(history, "WAREHOUSE_CREATED") && domHasTarget(domSummary, "masters-warehouses-card")) {
      return {
        action: "click",
        target: "masters-warehouses-card",
        reason: "Opening Warehouses next in the deterministic setup flow.",
      };
    }
    if (!hasHistoryMarker(history, "PRODUCT_CREATED") && domHasTarget(domSummary, "masters-products-card")) {
      return {
        action: "click",
        target: "masters-products-card",
        reason: "Opening Products to complete the deterministic masters flow.",
      };
    }
    if (workflow.name === "purchase" && domHasTarget(domSummary, "nav-purchase")) {
      return {
        action: "click",
        target: "nav-purchase",
        reason: "Moving to Purchase after master data is complete.",
      };
    }
  }

  if (
    (workflow.name === "purchase" || workflow.name === "org_e2e") &&
    /\/purchase(?:\/|$)/.test(domSummary.currentUrl) &&
    !/\/purchase\/(po|grn)(?:\/|$)/.test(domSummary.currentUrl)
  ) {
    if (!hasHistoryMarker(history, "PO_CREATED") && domHasTarget(domSummary, "purchase-orders-card")) {
      return {
        action: "click",
        target: "purchase-orders-card",
        reason: "Opening Purchase Orders first in the deterministic purchase flow.",
      };
    }
    if (hasHistoryMarker(history, "PO_APPROVED") && !hasHistoryMarker(history, "GRN_CREATED") && domHasTarget(domSummary, "purchase-grn-card")) {
      return {
        action: "click",
        target: "purchase-grn-card",
        reason: "Opening GRN after the PO is approved.",
      };
    }
  }

  if (/\/masters\/parties(?:\/|$)/.test(domSummary.currentUrl) && !hasHistoryMarker(history, "PARTY_CREATED")) {
    if (domHasTarget(domSummary, "party-name") && !hasHistoryMarker(history, "PARTY_NAME_FILLED")) {
      return {
        action: "type",
        target: "party-name",
        value: context.generatedData.supplierName,
        reason: "Entering the supplier name before creating the party.",
      };
    }
    if (domHasTarget(domSummary, "party-type") && !hasHistoryMarker(history, "PARTY_TYPE_SELECTED")) {
      return {
        action: "select",
        target: "party-type",
        value: "SUPER_STOCKIST",
        reason: "Selecting the supplier party type.",
      };
    }
    if (domHasTarget(domSummary, "Phone") && !hasHistoryMarker(history, "PARTY_PHONE_FILLED")) {
      return {
        action: "type",
        target: "Phone",
        value: "9876543210",
        reason: "Entering the supplier phone number.",
      };
    }
    if (domHasTarget(domSummary, "Email") && !hasHistoryMarker(history, "PARTY_EMAIL_FILLED")) {
      return {
        action: "type",
        target: "Email",
        value: `supplier.${context.runId.replace(/[^0-9]/g, "").slice(-6)}@medhaone.app`,
        reason: "Entering the supplier email address.",
      };
    }
    if (domHasTarget(domSummary, "Address") && !hasHistoryMarker(history, "PARTY_ADDRESS_FILLED")) {
      return {
        action: "type",
        target: "Address",
        value: "AI Test Party Address",
        reason: "Entering the supplier address.",
      };
    }
    if (domHasTarget(domSummary, "create-party")) {
      return {
        action: "click",
        target: "create-party",
        reason: "Submitting the supplier master form.",
      };
    }
  }

  if (/\/masters\/warehouses(?:\/|$)/.test(domSummary.currentUrl) && !hasHistoryMarker(history, "WAREHOUSE_CREATED")) {
    if (domHasTarget(domSummary, "warehouse-name") && !hasHistoryMarker(history, "WAREHOUSE_NAME_FILLED")) {
      return {
        action: "type",
        target: "warehouse-name",
        value: context.generatedData.warehouseName,
        reason: "Entering the warehouse name.",
      };
    }
    if (domHasTarget(domSummary, "warehouse-code") && !hasHistoryMarker(history, "WAREHOUSE_CODE_FILLED")) {
      return {
        action: "type",
        target: "warehouse-code",
        value: context.generatedData.warehouseCode,
        reason: "Entering the warehouse code.",
      };
    }
    if (domHasTarget(domSummary, "Address") && !hasHistoryMarker(history, "WAREHOUSE_ADDRESS_FILLED")) {
      return {
        action: "type",
        target: "Address",
        value: "AI Test Warehouse Address",
        reason: "Entering the warehouse address.",
      };
    }
    if (domHasTarget(domSummary, "create-warehouse")) {
      return {
        action: "click",
        target: "create-warehouse",
        reason: "Submitting the warehouse master form.",
      };
    }
  }

  if (/\/masters\/products(?:\/|$)/.test(domSummary.currentUrl) && !hasHistoryMarker(history, "PRODUCT_CREATED")) {
    if (domHasTarget(domSummary, "product-sku") && !hasHistoryMarker(history, "PRODUCT_SKU_FILLED")) {
      return {
        action: "type",
        target: "product-sku",
        value: context.generatedData.productSku,
        reason: "Entering the product SKU.",
      };
    }
    if (domHasTarget(domSummary, "product-name") && !hasHistoryMarker(history, "PRODUCT_NAME_FILLED")) {
      return {
        action: "type",
        target: "product-name",
        value: context.generatedData.productName,
        reason: "Entering the product name.",
      };
    }
    if (domHasTarget(domSummary, "UOM") && !hasHistoryMarker(history, "PRODUCT_UOM_FILLED")) {
      return {
        action: "type",
        target: "UOM",
        value: "PCS",
        reason: "Entering the required UOM before creating the product.",
      };
    }
    if (domHasTarget(domSummary, "create-product")) {
      return {
        action: "click",
        target: "create-product",
        reason: "Submitting the product master form.",
      };
    }
  }

  if (/\/purchase\/po(?:\/|$)/.test(domSummary.currentUrl)) {
    if (!hasHistoryMarker(history, "PO_CREATE_ATTEMPTED")) {
      if (domHasTarget(domSummary, "po-supplier-select") && !hasHistoryMarker(history, "PO_SUPPLIER_SELECTED")) {
        return {
          action: "select",
          target: "po-supplier-select",
          value: "__first_non_empty__",
          reason: "Selecting the only available supplier before creating the PO.",
        };
      }
      if (domHasTarget(domSummary, "po-warehouse-select") && !hasHistoryMarker(history, "PO_WAREHOUSE_SELECTED")) {
        return {
          action: "select",
          target: "po-warehouse-select",
          value: "__first_non_empty__",
          reason: "Selecting the only available warehouse before creating the PO.",
        };
      }
      if (
        domHasTarget(domSummary, "po-line-product-0") &&
        !hasHistoryMarker(history, "PO_PRODUCT_SELECTED")
      ) {
        return {
          action: "select",
          target: "po-line-product-0",
          value: "__first_non_empty__",
          reason: "Selecting the only available product for the PO line.",
        };
      }
      if (domHasTarget(domSummary, "po-line-qty-0") && !hasHistoryMarker(history, "PO_QTY_FILLED")) {
        return {
          action: "type",
          target: "po-line-qty-0",
          value: "10",
          reason: "Entering the ordered quantity before creating the PO.",
        };
      }
      if (domHasTarget(domSummary, "Unit cost") && !hasHistoryMarker(history, "PO_COST_FILLED")) {
        return {
          action: "type",
          target: "Unit cost",
          value: "125.50",
          reason: "Entering a deterministic unit cost before creating the PO.",
        };
      }
      if (domHasTarget(domSummary, "create-po")) {
        return {
          action: "click",
          target: "create-po",
          reason: "Submitting the purchase order after all required fields are filled.",
        };
      }
    }

    if (!hasHistoryMarker(history, "PO_APPROVED") && domHasTarget(domSummary, "approve-po")) {
      return {
        action: "click",
        target: "approve-po",
        reason: "Approving the draft PO so GRN creation is enabled.",
      };
    }
  }

  if (/\/purchase\/grn(?:\/|$)/.test(domSummary.currentUrl)) {
    if (!hasHistoryMarker(history, "GRN_CREATE_ATTEMPTED")) {
      if (domHasTarget(domSummary, "grn-po-select") && !hasHistoryMarker(history, "GRN_PO_SELECTED")) {
        return {
          action: "select",
          target: "grn-po-select",
          value: "__first_non_empty__",
          reason: "Selecting the approved PO before creating the GRN.",
        };
      }
      const qtyTarget = firstTargetMatching(domSummary, /^grn-line-qty-/i);
      if (qtyTarget && !hasHistoryMarker(history, "GRN_QTY_FILLED")) {
        return {
          action: "type",
          target: qtyTarget,
          value: "10",
          reason: "Entering the received quantity for the GRN line.",
        };
      }
      const batchTarget = firstTargetMatching(domSummary, /^grn-line-batch-/i);
      if (batchTarget && !hasHistoryMarker(history, "GRN_BATCH_FILLED")) {
        return {
          action: "type",
          target: batchTarget,
          value: context.generatedData.batchNo,
          reason: "Entering the deterministic batch number for the GRN line.",
        };
      }
      const expiryTarget = firstTargetMatching(domSummary, /^grn-line-expiry-/i);
      if (expiryTarget && !hasHistoryMarker(history, "GRN_EXPIRY_FILLED")) {
        return {
          action: "type",
          target: expiryTarget,
          value: context.generatedData.expiryDate,
          reason: "Entering the deterministic expiry date for the GRN line.",
        };
      }
      if (domHasTarget(domSummary, "create-grn-from-po")) {
        return {
          action: "click",
          target: "create-grn-from-po",
          reason: "Submitting the GRN after the line details are filled.",
        };
      }
    }

    if (hasHistoryMarker(history, "GRN_CREATED")) {
      if (domHasTarget(domSummary, "View")) {
        return {
          action: "click",
          target: "View",
          reason: "Opening the GRN detail page to post the GRN.",
        };
      }
      if (domHasTarget(domSummary, "post-grn")) {
        return {
          action: "click",
          target: "post-grn",
          reason: "Posting the GRN to finalize the inward stock movement.",
        };
      }
    }
  }

  if (
    workflow.name === "stock_adjustment" &&
    !hasHistoryMarker(history, "STOCK_ADJUSTMENT_POSTED")
  ) {
    const expectedRemarks = `AI-STOCK-ADJ-${context.generatedData.batchNo}`;
    const isInventoryUrl = /\/inventory(?:\/|$|\?)/.test(domSummary.currentUrl);
    const isStockOperationsView =
      /\/inventory\/stock-operations(?:\/|$|\?)/.test(domSummary.currentUrl) ||
      /[?&]tab=stock-operations(?:&|$)/.test(domSummary.currentUrl);
    const onStockAdjustmentPage = /\/inventory\/modules\/stock-adjustment(?:\/|$|\?)/.test(
      domSummary.currentUrl,
    );

    if (!onStockAdjustmentPage) {
      if (/\/dashboard(?:\/|$)/.test(domSummary.currentUrl)) {
        if (domHasTarget(domSummary, "nav-inventory")) {
          return {
            action: "click",
            target: "nav-inventory",
            reason: "Opening Inventory from the main sidebar.",
          };
        }
        if (domHasTarget(domSummary, "Inventory")) {
          return {
            action: "click",
            target: "Inventory",
            reason: "Opening Inventory from the dashboard sidebar.",
          };
        }
      }

      if (isStockOperationsView) {
        if (domHasTarget(domSummary, "nav-inventory-stock-operations-stock-adjustment")) {
          return {
            action: "click",
            target: "nav-inventory-stock-operations-stock-adjustment",
            reason: "Opening Stock Adjustment from the Stock Operations section.",
          };
        }
        if (domHasTarget(domSummary, "Stock Adjustment")) {
          return {
            action: "click",
            target: "Stock Adjustment",
            reason: "Opening Stock Adjustment from the operations page.",
          };
        }
      }

      if (isInventoryUrl) {
        if (domHasTarget(domSummary, "nav-inventory-stock-operations")) {
          return {
            action: "click",
            target: "nav-inventory-stock-operations",
            reason: "Opening Stock Operations from the Inventory tree.",
          };
        }
        if (domHasTarget(domSummary, "Stock Operations")) {
          return {
            action: "click",
            target: "Stock Operations",
            reason: "Opening Stock Operations within Inventory.",
          };
        }
      }

      return {
        action: "wait",
        target: "stock-adjustment-nav-ready",
        value: "1000",
        reason: "Waiting for Stock Adjustment navigation targets to become available.",
      };
    }

    if (onStockAdjustmentPage) {
      if (
        domHasTarget(domSummary, "stock-adjustment-select-row") &&
        !hasHistoryMarker(history, "STOCK_ADJUSTMENT_ROW_SELECTED")
      ) {
        return {
          action: "click",
          target: "stock-adjustment-select-row",
          reason: "Selecting the stock bucket to adjust.",
        };
      }
      if (
        domHasTarget(domSummary, "stock-adjustment-type") &&
        !hasHistoryMarker(history, "STOCK_ADJUSTMENT_TYPE_SELECTED")
      ) {
        return {
          action: "select",
          target: "stock-adjustment-type",
          value: "POSITIVE",
          reason: "Using a positive adjustment for found stock.",
        };
      }
      if (
        domHasTarget(domSummary, "stock-adjustment-qty") &&
        !hasHistoryMarker(history, "STOCK_ADJUSTMENT_QTY_FILLED")
      ) {
        return {
          action: "type",
          target: "stock-adjustment-qty",
          value: "1",
          reason: "Entering the deterministic adjustment quantity.",
        };
      }
      if (
        domHasTarget(domSummary, "stock-adjustment-reason") &&
        !hasHistoryMarker(history, "STOCK_ADJUSTMENT_REASON_SELECTED")
      ) {
        return {
          action: "select",
          target: "stock-adjustment-reason",
          value: "FOUND_STOCK",
          reason: "Selecting the stock adjustment reason.",
        };
      }
      if (
        domHasTarget(domSummary, "stock-adjustment-remarks") &&
        !hasHistoryMarker(history, "STOCK_ADJUSTMENT_REMARKS_FILLED")
      ) {
        return {
          action: "type",
          target: "stock-adjustment-remarks",
          value: expectedRemarks,
          reason: "Adding deterministic remarks for traceability.",
        };
      }
      if (domHasTarget(domSummary, "stock-adjustment-submit")) {
        return {
          action: "click",
          target: "stock-adjustment-submit",
          reason: "Submitting the stock adjustment after the form is complete.",
        };
      }
    }
  }

  if (
    hasHistoryMarker(history, "INVENTORY_REVIEWED") &&
    /\/reports(?:\/|$)/.test(domSummary.currentUrl) &&
    !/\/reports\/stock-inward(?:\/|$)/.test(domSummary.currentUrl) &&
    domHasTarget(domSummary, "report-stock-inward")
  ) {
    return {
      action: "click",
      target: "report-stock-inward",
      reason: "Opening the Stock Inward report to complete the workflow.",
    };
  }

  return null;
}

function compactDomSummary(
  workflow: WorkflowDefinition,
  history: string[],
  domSummary: DomSummary,
) {
  const phase = getWorkflowPhase(workflow, history, domSummary);
  const inventoryReviewed = hasHistoryMarker(history, "INVENTORY_REVIEWED");
  const mastersComplete =
    hasHistoryMarker(history, "PARTY_CREATED") &&
    hasHistoryMarker(history, "WAREHOUSE_CREATED") &&
    hasHistoryMarker(history, "PRODUCT_CREATED");
  const purchasePosted = hasHistoryMarker(history, "PURCHASE_POSTED");
  const inputs =
    workflow.name === "org_e2e" && phase === "super_admin_login"
      ? domSummary.inputs.filter(
          (item) => !/organization slug \(leave blank for super admin\)/i.test(item.target),
        )
      : workflow.name === "org_e2e" && phase === "org_created"
        ? domSummary.inputs.filter(
            (item) =>
              !/organization name|slug|max users|admin name|admin email|admin password/i.test(
                item.target,
              ),
          )
        : domSummary.inputs;
  const buttons =
    workflow.name === "org_e2e" && phase === "org_created"
      ? domSummary.buttons.filter((item) => !/create organization/i.test(item.target))
      : domSummary.buttons;
  const shouldConstrainNavigation =
    workflow.name === "org_e2e" ||
    workflow.name === "purchase" ||
    workflow.name === "stock_adjustment";
  const links =
    shouldConstrainNavigation
      ? domSummary.links.filter((item) => {
          if (
            !mastersComplete &&
            /^(nav-purchase|purchase|purchase-orders-card|purchase orders|purchase-grn-card|goods receipt notes|nav-inventory|inventory|stock operations|stock adjustment|inventory-stock-adjustment-card|nav-reports|reports|report-stock-inward|report-purchase-register|report-stock-movement)$/i.test(
              item.target,
            )
          ) {
            return false;
          }

          if (
            mastersComplete &&
            !purchasePosted &&
            /^(nav-inventory|inventory|stock operations|stock adjustment|inventory-stock-adjustment-card|nav-reports|reports|report-stock-inward|report-purchase-register|report-stock-movement)$/i.test(
              item.target,
            )
          ) {
            return false;
          }

          if (
            purchasePosted &&
            !inventoryReviewed &&
            /^(nav-reports|reports|report-stock-inward|report-purchase-register|report-stock-movement)$/i.test(
              item.target,
            )
          ) {
            return false;
          }

          if (
            /\/purchase(?:\/|$)/.test(domSummary.currentUrl) &&
            !/\/purchase\/(po|grn)(?:\/|$)/.test(domSummary.currentUrl)
          ) {
            if (
              !hasHistoryMarker(history, "PO_CREATED") &&
              /^(purchase-grn-card|goods receipt notes)$/i.test(item.target)
            ) {
              return false;
            }

            if (
              hasHistoryMarker(history, "PO_APPROVED") &&
              !hasHistoryMarker(history, "GRN_CREATED") &&
              /^(purchase-orders-card|purchase orders)$/i.test(item.target)
            ) {
              return false;
            }
          }

          if (
            /\/purchase\/po(?:\/|$)/.test(domSummary.currentUrl) &&
            !hasHistoryMarker(history, "PURCHASE_POSTED") &&
            /^(stock adjustment|inventory-stock-adjustment-card|nav-inventory|inventory|stock operations)$/i.test(
              item.target,
            )
          ) {
            return false;
          }

          return true;
        })
      : domSummary.links;

  return {
    currentUrl: domSummary.currentUrl,
    title: domSummary.title,
    headings: domSummary.headings,
    validationErrors: domSummary.validationErrors,
    buttons: buttons.map((item) => ({
      target: item.target,
      text: item.text,
    })),
    inputs: inputs.map((item) => ({
      target: item.target,
      label: item.label,
      placeholder: item.placeholder,
    })),
    selects: domSummary.selects.map((item) => ({
      target: item.target,
      label: item.label,
    })),
    links: links.map((item) => ({
      target: item.target,
      text: item.text,
      href: item.href,
    })),
  };
}

function buildPrompt(
  workflow: WorkflowDefinition,
  context: WorkflowContext,
  domSummary: DomSummary,
  step: number,
  history: string[],
): string {
  const recentHistory = history.slice(-6).join("\n") || "(none)";
  const runtimeHints = buildRuntimeHints(workflow, context, domSummary, history);

  return [
    `Workflow: ${workflow.name}`,
    `Mode: ${config.mode}`,
    `Step: ${step} of ${config.maxSteps}`,
    `Goal: ${workflow.goalSummary}`,
    `Current URL: ${domSummary.currentUrl}`,
    "Workflow guidance:",
    ...workflow.buildGuidance(context).map((line) => `- ${line}`),
    ...(runtimeHints.length > 0
      ? [
          "Current state hints:",
          ...runtimeHints.map((line) => `- ${line}`),
        ]
      : []),
    "Allowed actions: click, type, select, wait, noop",
    "Action JSON schema:",
    '{',
    '  "action": "click | type | select | wait | noop",',
    '  "target": "data-testid or visible text from the DOM summary",',
    '  "value": "optional string value",',
    '  "reason": "short explanation"',
    '}',
    "Rules:",
    "- Never use actions outside the schema.",
    "- Do not wrap the action in another object. Return the root keys action, target, value, and reason.",
    "- Use only targets listed in the DOM summary.",
    "- Every type or select action must include a non-empty value string.",
    "- After a successful sign-in click, do not target login fields again unless they are still visible in the DOM summary.",
    "- Never click transient loading buttons such as 'Signing in...', 'Loading...', or 'Saving...'.",
    "- On the super-admin RBAC login page, do not type into the organization slug field because it must stay blank.",
    "- Prefer deterministic progress toward the workflow goal.",
    "- If the page is loading, use wait.",
    "DOM summary (JSON):",
    JSON.stringify(compactDomSummary(workflow, history, domSummary)),
    "Recent execution history:",
    recentHistory,
  ].join("\n");
}

function didStateChange(before: DomSummary, after: DomSummary): boolean {
  return (
    before.currentUrl !== after.currentUrl ||
    before.title !== after.title ||
    (before.headings[0] ?? "") !== (after.headings[0] ?? "")
  );
}

function buildStepSignature(action: AiAction, domSummary: DomSummary): string {
  return [
    action.action,
    action.target,
    domSummary.currentUrl,
    domSummary.title,
    domSummary.headings[0] ?? "",
  ].join("|");
}

function extractMissingTarget(message: string): string | null {
  const match = message.match(/^Target '(.+)' is not present in the current DOM summary$/);
  return match?.[1] ?? null;
}

function isAuthControlTarget(target: string): boolean {
  return (
    /^email$/i.test(target) ||
    /^password$/i.test(target) ||
    /^sign in$/i.test(target) ||
    /^login-email$/i.test(target) ||
    /^login-password$/i.test(target) ||
    /^login-submit$/i.test(target) ||
    /^organization$/i.test(target) ||
    /^organization-selector$/i.test(target) ||
    /^organization slug \(leave blank for super admin\)$/i.test(target)
  );
}

function shouldRecoverStaleAuthPlan(
  workflow: WorkflowDefinition,
  domSummary: DomSummary,
  history: string[],
  error: unknown,
): boolean {
  if (!(error instanceof InvalidActionError)) {
    return false;
  }

  const isEmptyTarget = error.message === "Action target must be a non-empty string";
  const missingTarget = extractMissingTarget(error.message);
  if (!missingTarget && !isEmptyTarget) {
    return false;
  }

  if (workflow.name !== "login" && workflow.name !== "org_e2e") {
    return false;
  }

  const recentHistory = history.slice(-2);
  const justSubmittedLogin = recentHistory.some((line) =>
    /STEP \d+: click -> (Sign in|login-submit) \(pass\)/.test(line),
  );

  if (isAuthPageUrl(domSummary.currentUrl)) {
    return (missingTarget && isAuthControlTarget(missingTarget)) || isEmptyTarget;
  }

  return justSubmittedLogin;
}

function isOrganizationSubmitAction(
  workflow: WorkflowDefinition,
  action: AiAction,
  domSummary: DomSummary,
): boolean {
  if (workflow.name !== "org_e2e" || action.action !== "click") {
    return false;
  }

  if (!/create organization/i.test(action.target)) {
    return false;
  }

  return domSummary.inputs.some((input) => /organization name/i.test(input.target));
}

async function assertOrganizationCreated(
  page: Page,
  context: WorkflowContext,
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const organization = await findCreatedOrganization(page, context.organization.id);
    if (organization) {
      return null;
    }

    await page.waitForTimeout(500);
  }

  return `Organization '${context.organization.id}' was not found after submit`;
}

async function tryResetState(page: Page): Promise<string | null> {
  if (config.persistData) {
    return "AI_TEST_PERSIST_DATA=true; skipping reset-and-seed";
  }

  let response;
  try {
    response = await page.request.post("/api/test/reset-and-seed", {
      data: { seed_minimal: false },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `reset-and-seed unavailable (${message}); continuing without reset`;
  }

  if (response.status() === 404) {
    return "reset-and-seed endpoint unavailable; continuing without reset";
  }

  if (!response.ok()) {
    return `reset-and-seed failed with ${response.status()}; continuing without reset`;
  }

  return null;
}

async function getRbacBearerToken(page: Page): Promise<string | null> {
  if (!page.url().startsWith(config.baseOrigin)) {
    return null;
  }

  try {
    return await page.evaluate((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as { token?: unknown; parentSession?: { token?: unknown } };
        if (typeof parsed.token === "string" && parsed.token.trim().length > 0) {
          return parsed.token;
        }
        if (
          parsed.parentSession &&
          typeof parsed.parentSession.token === "string" &&
          parsed.parentSession.token.trim().length > 0
        ) {
          return parsed.parentSession.token;
        }
        return null;
      } catch {
        return null;
      }
    }, RBAC_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function findCreatedOrganization(
  page: Page,
  organizationId: string,
): Promise<RbacOrganizationRecord | null> {
  const token = await getRbacBearerToken(page);
  if (!token) {
    return null;
  }

  const response = await page.request.get("/api/rbac/organizations", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    return null;
  }

  const organizations = (await response.json()) as Array<{ id?: unknown; name?: unknown }>;
  const match = organizations.find((organization) => organization.id === organizationId);
  if (!match || typeof match.id !== "string" || typeof match.name !== "string") {
    return null;
  }

  return {
    id: match.id,
    name: match.name,
  };
}

async function cleanupCreatedOrganization(page: Page, context: WorkflowContext): Promise<string | null> {
  if (config.persistData || config.workflow !== "org_e2e") {
    return null;
  }

  const organization = await findCreatedOrganization(page, context.organization.id);
  if (!organization) {
    return null;
  }

  const token = await getRbacBearerToken(page);
  if (!token) {
    return `Cleanup skipped: org '${context.organization.id}' exists but no RBAC token is available`;
  }

  const response = await page.request.delete(`/api/rbac/organizations/${organization.id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    return `Cleanup failed for org '${organization.id}' with status ${response.status()}`;
  }

  return `Deleted test org '${organization.id}' because AI_TEST_PERSIST_DATA=false`;
}

async function transitionToErpLogin(
  page: Page,
  artifactDir: string,
  step: number,
): Promise<string> {
  return transitionToPath(page, artifactDir, step, "/login", "erp-login-handoff");
}

async function transitionToPath(
  page: Page,
  artifactDir: string,
  step: number,
  relativePath: string,
  screenshotLabel: string,
): Promise<string> {
  try {
    await page.goto(new URL(relativePath, config.baseUrl).toString(), {
      waitUntil: "networkidle",
      timeout: config.timeoutMs,
    });
    return await captureDiagnosticScreenshot(page, artifactDir, step, screenshotLabel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Navigation handoff to '${relativePath}' failed: ${message}`);
  }
}

async function writeReport(
  context: WorkflowContext,
  result: Omit<EngineResult, "reportPath">,
): Promise<string> {
  const reportDir = path.join(config.artifactsRoot, context.runId);
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(result, null, 2), "utf-8");
  return reportPath;
}

function logStep(
  step: number,
  action: AiAction | undefined,
  execution: StepExecution | undefined,
  error: string | undefined,
): void {
  const actionLabel = action ? `${action.action} -> ${action.target}` : "no-action";
  const result = execution?.ok && !error ? "PASS" : "FAIL";
  const detail = error ? ` | ${error}` : execution?.error ? ` | ${execution.error}` : "";
  console.log(`[AI][step ${step}] ${actionLabel} => ${result}${detail}`);
}

export async function runAiEngine(): Promise<EngineResult> {
  const workflow = WORKFLOWS[config.workflow];
  const context = buildContext();
  const artifactDir = path.join(config.artifactsRoot, context.runId);
  const history: string[] = [];
  const steps: StepRecord[] = [];

  console.log(`[AI] Starting ${workflow.name} workflow in ${config.mode} mode`);
  console.log(`[AI] Base URL: ${config.baseUrl}`);

  const browser = await chromium.launch({ headless: config.headless });
  const page = await browser.newPage({
    baseURL: config.baseUrl,
    viewport: { width: 1440, height: 900 },
  });

  let stopReason: EngineResult["stopReason"] = "step_limit_reached";
  let invalidOutputStreak = 0;
  let consecutiveAuthRecoveries = 0;
  const recentSignatures: string[] = [];

  try {
    const resetMessage = await tryResetState(page);
    if (resetMessage) {
      console.log(`[AI] ${resetMessage}`);
    }

    await page.goto(new URL(workflow.entryPath, config.baseUrl).toString(), {
      waitUntil: "networkidle",
      timeout: config.timeoutMs,
    });

    for (let step = 1; step <= config.maxSteps; step += 1) {
      if (workflow.name !== "login") {
        await syncWorkflowProgressMarkers(page, context, history);
      }
      const hadPartyCreated = hasHistoryMarker(history, "PARTY_CREATED");
      const hadWarehouseCreated = hasHistoryMarker(history, "WAREHOUSE_CREATED");
      const hadProductCreated = hasHistoryMarker(history, "PRODUCT_CREATED");
      const domSummary = await extractDomSummary(page);
      const prompt = buildPrompt(workflow, context, domSummary, step, history);

      let action: AiAction | undefined;
      let execution: StepExecution | undefined;
      let errorMessage: string | undefined;

      try {
        const forcedAction = deterministicWorkflowAction(
          workflow,
          context,
          domSummary,
          history,
        );
        const plannerResponse = forcedAction ? null : await requestPlannerAction(prompt);
        const rawAction = repairPlannerAction(
          forcedAction ?? plannerResponse,
          workflow,
          context,
          domSummary,
          history,
        );
        action = validateAction(rawAction, domSummary, workflow);
        invalidOutputStreak = 0;
        consecutiveAuthRecoveries = 0;
      } catch (error) {
        if (shouldRecoverStaleAuthPlan(workflow, domSummary, history, error)) {
          const recoveryAction: AiAction = {
            action: "wait",
            target: "auth-transition",
            value: "1000",
            reason: "Recovering from a stale login target while the authentication flow transitions.",
          };
          const recoveryExecution = await executeAction(
            page,
            recoveryAction,
            domSummary,
            artifactDir,
            step,
          );
          const recoveryError = recoveryExecution.ok ? undefined : recoveryExecution.error;
          steps.push({
            step,
            action: recoveryAction,
            success: recoveryExecution.ok,
            error: recoveryError,
            screenshotPath: recoveryExecution.screenshotPath,
          });
          history.push(
            `STEP ${step}: ${recoveryAction.action} -> ${recoveryAction.target} (${recoveryExecution.ok ? "pass" : "fail"})${recoveryError ? ` | ${recoveryError}` : ""}`,
          );
          logStep(step, recoveryAction, recoveryExecution, recoveryError);
          invalidOutputStreak = 0;
          consecutiveAuthRecoveries += 1;
          if (!recoveryExecution.ok) {
            stopReason = "fatal_error";
            break;
          }
          if (consecutiveAuthRecoveries >= 3) {
            const repeatMessage =
              "Authentication transition did not complete after repeated recovery waits";
            steps[steps.length - 1].success = false;
            steps[steps.length - 1].error = repeatMessage;
            if (!steps[steps.length - 1].screenshotPath) {
              steps[steps.length - 1].screenshotPath = await captureDiagnosticScreenshot(
                page,
                artifactDir,
                step,
                "auth-transition-stalled",
              );
            }
            history[history.length - 1] = `${history[history.length - 1]} | ${repeatMessage}`;
            console.log(`[AI] ${repeatMessage}`);
            stopReason = "no_progress_limit";
            break;
          }
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        errorMessage = message;
        consecutiveAuthRecoveries = 0;
        const screenshotPath = await captureDiagnosticScreenshot(
          page,
          artifactDir,
          step,
          "invalid-plan",
        );
        steps.push({
          step,
          success: false,
          error: message,
          screenshotPath,
        });
        history.push(`STEP ${step}: invalid planner output (${message})`);
        logStep(step, undefined, undefined, message);

        if (error instanceof InvalidPlannerOutputError || error instanceof InvalidActionError) {
          invalidOutputStreak += 1;
          if (invalidOutputStreak >= 3) {
            stopReason = "invalid_output_limit";
            break;
          }
          continue;
        }

        stopReason = "fatal_error";
        break;
      }

      execution = await executeAction(page, action, domSummary, artifactDir, step);
      if (!execution.ok) {
        errorMessage = execution.error;
      }

      let postActionDom = await extractDomSummary(page);
      let screenshotPath = execution.screenshotPath;
      if (!screenshotPath && didStateChange(domSummary, postActionDom)) {
        screenshotPath = await captureDiagnosticScreenshot(page, artifactDir, step, action.target);
      }

      if (execution.ok && isOrganizationSubmitAction(workflow, action, domSummary)) {
        const organizationCreateFailure = await assertOrganizationCreated(page, context);
        if (organizationCreateFailure) {
          errorMessage = organizationCreateFailure;
          if (!screenshotPath) {
            screenshotPath = await captureDiagnosticScreenshot(
              page,
              artifactDir,
              step,
              "organization-create-failed",
            );
          }
        } else {
          history.push("ORG_CREATED_VERIFIED");
          const handoffScreenshotPath = await transitionToErpLogin(page, artifactDir, step);
          screenshotPath = handoffScreenshotPath;
          postActionDom = await extractDomSummary(page);
          history.push("ERP_LOGIN_HANDOFF");
        }
      }

      const invariantFailures = await runInvariants(page, postActionDom, workflow, context);
      if (invariantFailures.length > 0) {
        errorMessage = invariantFailures.join("; ");
      }

      if (
        execution.ok &&
        workflow.name === "org_e2e" &&
        action.action === "click" &&
        action.target === "super-admin-sign-out" &&
        history.some((line) => line.includes("ORG_CREATED_VERIFIED")) &&
        !errorMessage
      ) {
        const handoffScreenshotPath = await transitionToErpLogin(page, artifactDir, step);
        screenshotPath = screenshotPath ?? handoffScreenshotPath;
        postActionDom = await extractDomSummary(page);
        history.push("ERP_LOGIN_HANDOFF");
      }

      if (
        workflow.name === "org_e2e" &&
        /\/inventory(?:\/|$)/.test(postActionDom.currentUrl) &&
        !hasHistoryMarker(history, "INVENTORY_REVIEWED")
      ) {
        history.push("INVENTORY_REVIEWED");
      }

      if (execution.ok) {
        if (action.action === "type" && action.target === "login-email" && workflow.name !== "org_e2e") {
          history.push("STANDARD_LOGIN_EMAIL_FILLED");
        }
        if (action.action === "type" && action.target === "login-password" && workflow.name !== "org_e2e") {
          history.push("STANDARD_LOGIN_PASSWORD_FILLED");
        }
        if (action.action === "select" && action.target === "organization-selector" && workflow.name !== "org_e2e") {
          history.push("STANDARD_LOGIN_ORG_SELECTED");
        }
        if (action.action === "click" && action.target === "login-submit" && workflow.name !== "org_e2e") {
          history.push("STANDARD_LOGIN_SUBMITTED");
        }
        if (action.action === "type" && action.target === "party-name") {
          history.push("PARTY_NAME_FILLED");
        }
        if (action.action === "select" && action.target === "party-type") {
          history.push("PARTY_TYPE_SELECTED");
        }
        if (action.action === "type" && action.target === "Phone" && /\/masters\/parties(?:\/|$)/.test(domSummary.currentUrl)) {
          history.push("PARTY_PHONE_FILLED");
        }
        if (action.action === "type" && action.target === "Email" && /\/masters\/parties(?:\/|$)/.test(domSummary.currentUrl)) {
          history.push("PARTY_EMAIL_FILLED");
        }
        if (action.action === "type" && action.target === "Address" && /\/masters\/parties(?:\/|$)/.test(domSummary.currentUrl)) {
          history.push("PARTY_ADDRESS_FILLED");
        }
        if (action.action === "type" && action.target === "warehouse-name") {
          history.push("WAREHOUSE_NAME_FILLED");
        }
        if (action.action === "type" && action.target === "warehouse-code") {
          history.push("WAREHOUSE_CODE_FILLED");
        }
        if (action.action === "type" && action.target === "Address" && /\/masters\/warehouses(?:\/|$)/.test(domSummary.currentUrl)) {
          history.push("WAREHOUSE_ADDRESS_FILLED");
        }
        if (action.action === "type" && action.target === "product-sku") {
          history.push("PRODUCT_SKU_FILLED");
        }
        if (action.action === "type" && action.target === "product-name") {
          history.push("PRODUCT_NAME_FILLED");
        }
        if (action.action === "type" && action.target === "UOM") {
          history.push("PRODUCT_UOM_FILLED");
        }
        if (action.action === "select" && action.target === "po-supplier-select") {
          history.push("PO_SUPPLIER_SELECTED");
        }
        if (action.action === "select" && action.target === "po-warehouse-select") {
          history.push("PO_WAREHOUSE_SELECTED");
        }
        if (action.action === "select" && action.target === "po-line-product-0") {
          history.push("PO_PRODUCT_SELECTED");
        }
        if (action.action === "type" && action.target === "po-line-qty-0") {
          history.push("PO_QTY_FILLED");
        }
        if (action.action === "type" && action.target === "Unit cost") {
          history.push("PO_COST_FILLED");
        }
        if (action.action === "click" && action.target === "create-po") {
          history.push("PO_CREATE_ATTEMPTED");
        }
        if (action.action === "click" && action.target === "approve-po" && !hasHistoryMarker(history, "PO_APPROVED")) {
          history.push("PO_APPROVED");
        }
        if (action.action === "select" && action.target === "grn-po-select") {
          history.push("GRN_PO_SELECTED");
        }
        if (action.action === "type" && /^grn-line-qty-/i.test(action.target)) {
          history.push("GRN_QTY_FILLED");
        }
        if (action.action === "type" && /^grn-line-batch-/i.test(action.target)) {
          history.push("GRN_BATCH_FILLED");
        }
        if (action.action === "type" && /^grn-line-expiry-/i.test(action.target)) {
          history.push("GRN_EXPIRY_FILLED");
        }
        if (action.action === "click" && action.target === "create-grn-from-po") {
          history.push("GRN_CREATE_ATTEMPTED");
        }
        if (action.action === "click" && action.target === "post-grn") {
          history.push("GRN_POSTED");
        }
        if (action.action === "click" && action.target === "stock-adjustment-select-row") {
          history.push("STOCK_ADJUSTMENT_ROW_SELECTED");
        }
        if (action.action === "select" && action.target === "stock-adjustment-type") {
          history.push("STOCK_ADJUSTMENT_TYPE_SELECTED");
        }
        if (action.action === "type" && action.target === "stock-adjustment-qty") {
          history.push("STOCK_ADJUSTMENT_QTY_FILLED");
        }
        if (action.action === "select" && action.target === "stock-adjustment-reason") {
          history.push("STOCK_ADJUSTMENT_REASON_SELECTED");
        }
        if (action.action === "type" && action.target === "stock-adjustment-remarks") {
          history.push("STOCK_ADJUSTMENT_REMARKS_FILLED");
        }
        if (action.action === "click" && action.target === "Stock Operations") {
          history.push("STOCK_OPS_TAB_OPENED");
        }
      }

      if (workflow.name === "org_e2e" && execution.ok) {
        if (action.action === "type" && action.target === "Email" && isRbacLoginUrl(domSummary.currentUrl)) {
          history.push("SUPER_ADMIN_EMAIL_FILLED");
        }
        if (action.action === "type" && action.target === "Password" && isRbacLoginUrl(domSummary.currentUrl)) {
          history.push("SUPER_ADMIN_PASSWORD_FILLED");
        }
        if (action.action === "click" && action.target === "Sign in" && isRbacLoginUrl(domSummary.currentUrl)) {
          history.push("SUPER_ADMIN_LOGIN_SUBMITTED");
        }
        if (action.action === "type" && action.target === "login-email") {
          history.push("ORG_ADMIN_ERP_EMAIL_FILLED");
        }
        if (action.action === "type" && action.target === "login-password") {
          history.push("ORG_ADMIN_ERP_PASSWORD_FILLED");
        }
        if (action.action === "select" && action.target === "organization-selector") {
          history.push("ORG_ADMIN_ERP_ORG_SELECTED");
        }
        if (action.action === "click" && action.target === "login-submit") {
          history.push("ORG_ADMIN_ERP_LOGIN_SUBMITTED");
        }
        if (action.action === "type" && action.target === "party-name") {
          history.push("PARTY_NAME_FILLED");
        }
        if (action.action === "select" && action.target === "party-type") {
          history.push("PARTY_TYPE_SELECTED");
        }
        if (action.action === "type" && action.target === "Phone") {
          history.push("PARTY_PHONE_FILLED");
        }
        if (action.action === "type" && action.target === "Email") {
          history.push("PARTY_EMAIL_FILLED");
        }
        if (action.action === "type" && action.target === "Address" && /\/masters\/parties(?:\/|$)/.test(postActionDom.currentUrl)) {
          history.push("PARTY_ADDRESS_FILLED");
        }
        if (action.action === "type" && action.target === "warehouse-name") {
          history.push("WAREHOUSE_NAME_FILLED");
        }
        if (action.action === "type" && action.target === "warehouse-code") {
          history.push("WAREHOUSE_CODE_FILLED");
        }
        if (action.action === "type" && action.target === "Address" && /\/masters\/warehouses(?:\/|$)/.test(postActionDom.currentUrl)) {
          history.push("WAREHOUSE_ADDRESS_FILLED");
        }
        if (action.action === "type" && action.target === "product-sku") {
          history.push("PRODUCT_SKU_FILLED");
        }
        if (action.action === "type" && action.target === "product-name") {
          history.push("PRODUCT_NAME_FILLED");
        }
        if (action.action === "type" && action.target === "UOM") {
          history.push("PRODUCT_UOM_FILLED");
        }
        if (action.action === "select" && action.target === "po-supplier-select") {
          history.push("PO_SUPPLIER_SELECTED");
        }
        if (action.action === "select" && action.target === "po-warehouse-select") {
          history.push("PO_WAREHOUSE_SELECTED");
        }
        if (action.action === "select" && action.target === "po-line-product-0") {
          history.push("PO_PRODUCT_SELECTED");
        }
        if (action.action === "type" && action.target === "po-line-qty-0") {
          history.push("PO_QTY_FILLED");
        }
        if (action.action === "type" && action.target === "Unit cost") {
          history.push("PO_COST_FILLED");
        }
        if (action.action === "click" && action.target === "create-po") {
          history.push("PO_CREATE_ATTEMPTED");
        }
        if (action.action === "click" && action.target === "approve-po" && !hasHistoryMarker(history, "PO_APPROVED")) {
          history.push("PO_APPROVED");
        }
        if (action.action === "select" && action.target === "grn-po-select") {
          history.push("GRN_PO_SELECTED");
        }
        if (action.action === "type" && /^grn-line-qty-/i.test(action.target)) {
          history.push("GRN_QTY_FILLED");
        }
        if (action.action === "type" && /^grn-line-batch-/i.test(action.target)) {
          history.push("GRN_BATCH_FILLED");
        }
        if (action.action === "type" && /^grn-line-expiry-/i.test(action.target)) {
          history.push("GRN_EXPIRY_FILLED");
        }
        if (action.action === "click" && action.target === "create-grn-from-po") {
          history.push("GRN_CREATE_ATTEMPTED");
        }
        if (action.action === "click" && action.target === "post-grn") {
          history.push("GRN_POSTED");
        }
      }

      if (workflow.name !== "login") {
        await syncWorkflowProgressMarkers(page, context, history);
      }

      if (workflow.name === "masters" || workflow.name === "purchase" || workflow.name === "org_e2e") {
        if (
          execution.ok &&
          action.action === "click" &&
          action.target === "create-party" &&
          !hadPartyCreated &&
          hasHistoryMarker(history, "PARTY_CREATED")
        ) {
          const handoffPath = workflow.name === "masters" ? "/masters/products" : "/masters/warehouses";
          const handoffScreenshotPath = await transitionToPath(
            page,
            artifactDir,
            step,
            handoffPath,
            "party-created-handoff",
          );
          screenshotPath = screenshotPath ?? handoffScreenshotPath;
          postActionDom = await extractDomSummary(page);
        }

        if (
          execution.ok &&
          workflow.name !== "masters" &&
          action.action === "click" &&
          action.target === "create-warehouse" &&
          !hadWarehouseCreated &&
          hasHistoryMarker(history, "WAREHOUSE_CREATED")
        ) {
          const handoffScreenshotPath = await transitionToPath(
            page,
            artifactDir,
            step,
            "/masters/products",
            "warehouse-created-handoff",
          );
          screenshotPath = screenshotPath ?? handoffScreenshotPath;
          postActionDom = await extractDomSummary(page);
        }

        if (
          execution.ok &&
          workflow.name === "purchase" &&
          action.action === "click" &&
          action.target === "approve-po"
        ) {
          const handoffScreenshotPath = await transitionToPath(
            page,
            artifactDir,
            step,
            "/purchase/grn",
            "po-approved-handoff",
          );
          screenshotPath = screenshotPath ?? handoffScreenshotPath;
          postActionDom = await extractDomSummary(page);
        }

        if (
          execution.ok &&
          action.action === "click" &&
          action.target === "create-product" &&
          !hadProductCreated &&
          hasHistoryMarker(history, "PRODUCT_CREATED")
        ) {
          if (workflow.name === "purchase" || workflow.name === "org_e2e") {
            const handoffScreenshotPath = await transitionToPath(
              page,
              artifactDir,
              step,
              "/purchase",
              "product-created-handoff",
            );
            screenshotPath = screenshotPath ?? handoffScreenshotPath;
            postActionDom = await extractDomSummary(page);
          }
        }
      }

      if (workflow.name === "org_e2e") {

        if (
          execution.ok &&
          action.action === "click" &&
          action.target === "post-grn" &&
          !hasHistoryMarker(history, "INVENTORY_REVIEWED")
        ) {
          const handoffScreenshotPath = await transitionToPath(
            page,
            artifactDir,
            step,
            "/inventory",
            "purchase-posted-handoff",
          );
          screenshotPath = screenshotPath ?? handoffScreenshotPath;
          postActionDom = await extractDomSummary(page);
          if (!hasHistoryMarker(history, "INVENTORY_REVIEWED")) {
            history.push("INVENTORY_REVIEWED");
          }
        }

        if (
          execution.ok &&
          action.action === "click" &&
          action.target === "approve-po"
        ) {
          const handoffScreenshotPath = await transitionToPath(
            page,
            artifactDir,
            step,
            "/purchase/grn",
            "po-approved-handoff",
          );
          screenshotPath = screenshotPath ?? handoffScreenshotPath;
          postActionDom = await extractDomSummary(page);
        }
      }

      const success = execution.ok && !errorMessage && invariantFailures.length === 0;
      steps.push({
        step,
        action,
        success,
        error: errorMessage,
        screenshotPath,
      });

      history.push(
        `STEP ${step}: ${action.action} -> ${action.target} (${success ? "pass" : "fail"})${errorMessage ? ` | ${errorMessage}` : ""}`,
      );
      logStep(step, action, execution, errorMessage);

      const signature = buildStepSignature(action, postActionDom);
      recentSignatures.push(signature);
      if (recentSignatures.length > 12) {
        recentSignatures.shift();
      }

      const repeatedPatternCount = recentSignatures.filter((item) => item === signature).length;
      if (repeatedPatternCount >= 3) {
        stopReason = "no_progress_limit";
        if (!errorMessage) {
          const repeatMessage = `Repeated action/page pattern detected for '${action.action} -> ${action.target}'`;
          steps[steps.length - 1].success = false;
          steps[steps.length - 1].error = repeatMessage;
          if (!steps[steps.length - 1].screenshotPath) {
            steps[steps.length - 1].screenshotPath = await captureDiagnosticScreenshot(
              page,
              artifactDir,
              step,
              "no-progress",
            );
          }
          history[history.length - 1] = `${history[history.length - 1]} | ${repeatMessage}`;
          console.log(`[AI] ${repeatMessage}`);
        }
        break;
      }

      if (errorMessage || invariantFailures.length > 0) {
        stopReason = "invariant_failure";
        break;
      }

      if (
        workflow.name === "purchase" &&
        execution.ok &&
        action.action === "click" &&
        action.target === "post-grn"
      ) {
        stopReason = "workflow_complete";
        break;
      }

      const readyForCompletion =
        workflow.name !== "org_e2e" || hasHistoryMarker(history, "INVENTORY_REVIEWED");
      if (readyForCompletion && (await workflow.isComplete(page, context))) {
        stopReason = "workflow_complete";
        break;
      }
    }
  } catch (error) {
    stopReason = "fatal_error";
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[AI] Fatal error: ${message}`);
  } finally {
    const cleanupMessage = await cleanupCreatedOrganization(page, context);
    if (cleanupMessage) {
      console.log(`[AI] ${cleanupMessage}`);
    }
    await browser.close();
  }

  const resultWithoutPath = {
    success: stopReason === "workflow_complete",
    stopReason,
    steps,
  };
  const reportPath = await writeReport(context, resultWithoutPath);

  console.log(
    `[AI] Finished ${workflow.name} workflow with status=${resultWithoutPath.success ? "SUCCESS" : "FAILED"} reason=${stopReason}`,
  );
  console.log(`[AI] Report: ${reportPath}`);

  return {
    ...resultWithoutPath,
    reportPath,
  };
}
