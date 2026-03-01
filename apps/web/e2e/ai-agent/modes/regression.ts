import type { Page } from "@playwright/test";

import type { DOMSummary } from "../dom-summarizer";

export function buildRegressionPrompt(
  summary: DOMSummary,
  step: number,
  transcript: string[],
): string {
  const recentTranscript = transcript.slice(-5).join("\n");
  return `Mode: regression
Goal: Execute complete PO -> GRN workflow and keep system invariants valid.
Credentials: email=admin@medhaone.app password=ChangeMe123!
Step: ${step}

Rules:
- Return ONLY one JSON object with keys: action,target,value(optional),reason.
- Allowed action values: click,fill,select,navigate,assert.
- target must be a visible data-testid from availableTestIds.
- Use action=navigate only with target="__page__" and value as absolute URL.
- Never propose JavaScript, API calls, filesystem, or shell commands.
- Prefer deterministic master data names so flow is reproducible.

Current page summary (JSON):
${JSON.stringify(summary)}

Recent transcript:
${recentTranscript || "(none)"}
`;
}

export async function isRegressionGoalAchieved(page: Page): Promise<boolean> {
  const poResponse = await page.request.get("/api/purchase/po");
  if (!poResponse.ok()) {
    return false;
  }
  const poData = (await poResponse.json()) as { items: Array<{ status: string }> };

  const grnResponse = await page.request.get("/api/purchase/grn");
  if (!grnResponse.ok()) {
    return false;
  }
  const grns = (await grnResponse.json()) as Array<{ status: string }>;

  return (
    poData.items.some((po) => po.status === "CLOSED") &&
    grns.some((grn) => grn.status === "POSTED")
  );
}

