import type { Page } from "@playwright/test";

import type { DOMSummary } from "../dom-summarizer";

export function buildChaosPrompt(
  summary: DOMSummary,
  step: number,
  transcript: string[],
): string {
  const recentTranscript = transcript.slice(-6).join("\n");
  return `Mode: chaos
Goal: Explore guarded failure paths while staying inside safe action whitelist.
Try cases like over-receipt, wrong warehouse, duplicate posting, invalid numeric input, and skipping approval.
Credentials: email=admin@medhaone.app password=ChangeMe123!
Step: ${step}

Rules:
- Return ONLY one JSON object with keys: action,target,value(optional),reason.
- Allowed action values: click,fill,select,navigate,assert.
- target must be a visible data-testid from availableTestIds.
- Use action=navigate only with target="__page__" and value as absolute URL.
- Never propose JavaScript, API calls, filesystem, or shell commands.
- If blocked, choose a nearby safe exploratory action.

Current page summary (JSON):
${JSON.stringify(summary)}

Recent transcript:
${recentTranscript || "(none)"}
`;
}

export async function isChaosGoalAchieved(page: Page): Promise<boolean> {
  const grnResponse = await page.request.get("/api/purchase/grn");
  if (!grnResponse.ok()) {
    return false;
  }
  const grns = (await grnResponse.json()) as Array<{ status: string }>;
  return grns.some((grn) => grn.status === "POSTED");
}

