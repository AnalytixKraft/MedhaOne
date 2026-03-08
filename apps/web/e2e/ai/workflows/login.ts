import type { Page } from "@playwright/test";

import type { WorkflowContext, WorkflowDefinition } from "../engine.ts";

function buildLoginGuidance(): string[] {
  return [
    "Use the ERP login page.",
    "Login with seeded credentials: e2e.admin@medhaone.app / ChangeMe123!.",
    "After login, wait for the dashboard route to load.",
    "Do not navigate outside /login or /dashboard.",
  ];
}

async function isLoginComplete(page: Page): Promise<boolean> {
  return /\/dashboard(?:\/|$)/.test(page.url());
}

export const loginWorkflow: WorkflowDefinition = {
  name: "login",
  entryPath: "/login",
  allowedPathPrefixes: ["/login", "/dashboard"],
  allowsDestructiveActions: false,
  requiredInvariants: ["within_scope", "no_app_errors"],
  goalSummary: "Authenticate with the seeded admin account and land on the ERP dashboard.",
  buildGuidance: (_context: WorkflowContext) => buildLoginGuidance(),
  isComplete: isLoginComplete,
};
