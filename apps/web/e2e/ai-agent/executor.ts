import path from "node:path";

import { expect, type Page } from "@playwright/test";

import type { AgentAction } from "./action-validator";

export type ExecuteActionOptions = {
  stepNumber: number;
  timeoutMs: number;
  artifactDir: string;
};

export type ExecuteActionResult = {
  ok: boolean;
  screenshotPath: string;
  error?: string;
};

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function executeAction(
  page: Page,
  action: AgentAction,
  options: ExecuteActionOptions,
): Promise<ExecuteActionResult> {
  const baseName = `${String(options.stepNumber).padStart(2, "0")}-${action.action}-${sanitizeName(action.target)}`;

  const saveShot = async (suffix = ""): Promise<string> => {
    const fileName = `${baseName}${suffix}.png`;
    const screenshotPath = path.join(options.artifactDir, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  };

  try {
    if (action.action === "navigate") {
      await page.goto(action.value ?? "", {
        timeout: options.timeoutMs,
        waitUntil: "networkidle",
      });
    } else {
      const target = page.getByTestId(action.target).first();

      if (action.action === "click") {
        await target.click({ timeout: options.timeoutMs });
      } else if (action.action === "fill") {
        await target.fill(action.value ?? "", { timeout: options.timeoutMs });
      } else if (action.action === "select") {
        await target.selectOption(action.value ?? "", { timeout: options.timeoutMs });
      } else if (action.action === "assert") {
        if (action.value) {
          await expect(target).toContainText(action.value, { timeout: options.timeoutMs });
        } else {
          await expect(target).toBeVisible({ timeout: options.timeoutMs });
        }
      }
    }

    await page.waitForTimeout(150);
    const screenshotPath = await saveShot();
    return { ok: true, screenshotPath };
  } catch (error) {
    const screenshotPath = await saveShot("-failed");
    return {
      ok: false,
      screenshotPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

