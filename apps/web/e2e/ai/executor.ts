import fs from "node:fs/promises";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import type { DomElementSummary, DomSummary } from "./dom-extractor.ts";
import type { AiAction } from "./validators/action-schema.ts";

export type StepExecution = {
  ok: boolean;
  error?: string;
  screenshotPath?: string;
};

function isPointerInterceptError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /intercepts pointer events/i.test(error.message);
}

function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function findTarget(domSummary: DomSummary, target: string): DomElementSummary | undefined {
  return domSummary.targets.find((entry) => entry.target === target);
}

function locatorForElement(page: Page, element: DomElementSummary): Locator {
  if (element.testId) {
    return page.getByTestId(element.testId).first();
  }

  if (element.kind === "button" && element.text) {
    // Prefer the most recently rendered matching button, which is typically the active control
    // inside modals/drawers rather than a background trigger with the same label.
    return page.getByRole("button", { name: element.text, exact: false }).last();
  }

  if (element.kind === "link" && element.text) {
    return page.getByRole("link", { name: element.text, exact: false }).first();
  }

  if (element.kind === "input") {
    if (element.label) {
      return page.getByLabel(element.label, { exact: false }).first();
    }
    if (element.placeholder) {
      return page.getByPlaceholder(element.placeholder, { exact: false }).first();
    }
  }

  if (element.kind === "select" && element.label) {
    return page.getByLabel(element.label, { exact: false }).first();
  }

  if (element.text) {
    return page.getByText(element.text, { exact: false }).first();
  }

  throw new Error(`Unable to resolve locator for target '${element.target}'`);
}

async function writeScreenshot(
  page: Page,
  artifactsDir: string,
  step: number,
  suffix: string,
): Promise<string> {
  const screenshotPath = path.join(
    artifactsDir,
    `${String(step).padStart(2, "0")}-${sanitizeLabel(suffix || "step")}.png`,
  );
  await fs.mkdir(artifactsDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

export async function captureDiagnosticScreenshot(
  page: Page,
  artifactsDir: string,
  step: number,
  label: string,
): Promise<string> {
  return writeScreenshot(page, artifactsDir, step, label);
}

export async function executeAction(
  page: Page,
  action: AiAction,
  domSummary: DomSummary,
  artifactsDir: string,
  step: number,
): Promise<StepExecution> {
  try {
    if (action.action === "wait") {
      const timeout = Math.min(
        Math.max(Number.parseInt(action.value ?? "750", 10) || 750, 250),
        5_000,
      );
      await page.waitForTimeout(timeout);
    } else if (action.action !== "noop") {
      const element = findTarget(domSummary, action.target);
      if (!element) {
        throw new Error(`Target '${action.target}' is no longer visible`);
      }

      const locator = locatorForElement(page, element);
      if (action.action === "click") {
        // Give controlled forms a moment to commit the latest typed value before submit clicks.
        await page.waitForTimeout(150);
        try {
          await locator.click({ timeout: 10_000 });
        } catch (error) {
          if (!isPointerInterceptError(error)) {
            throw error;
          }
          await locator.click({ timeout: 5_000, force: true });
        }
      } else if (action.action === "type") {
        await locator.fill(action.value ?? "", { timeout: 10_000 });
      } else if (action.action === "select") {
        if (action.value === "__first_non_empty__") {
          await locator.selectOption({ index: 1 }, { timeout: 10_000 });
        } else {
          try {
            await locator.selectOption(action.value ?? "", { timeout: 10_000 });
          } catch {
            await locator.selectOption({ label: action.value ?? "" }, { timeout: 10_000 });
          }
        }
      }
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 1_500 });
    } catch {
      await page.waitForTimeout(200);
    }

    const screenshotPath = await writeScreenshot(page, artifactsDir, step, action.target);
    return { ok: true, screenshotPath };
  } catch (error) {
    const screenshotPath = await writeScreenshot(
      page,
      artifactsDir,
      step,
      `${action.target}-failed`,
    );
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      screenshotPath,
    };
  }
}
