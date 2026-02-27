import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

import { chromium, expect } from "@playwright/test";

type GuidedAction =
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "expect"
  | "wait";

type GuidedStep = {
  id: string;
  description: string;
  action: GuidedAction;
  selector?: string;
  value?: unknown;
  checkpoint?: boolean;
  screenshot?: boolean;
};

type GuidedScript = {
  name: string;
  description?: string;
  resetBeforeRun?: boolean;
  steps: GuidedStep[];
};

type StepStatus = "PASS" | "FAIL" | "SKIPPED";

type StepResult = {
  id: string;
  description: string;
  action: GuidedAction;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: StepStatus;
  screenshotPath?: string;
  error?: string;
};

type RunReport = {
  name: string;
  scriptPath: string;
  baseURL: string;
  apiBaseURL: string;
  resetAttempted: boolean;
  resetSucceeded: boolean;
  aborted: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  steps: StepResult[];
  error?: string;
};

type RunnerOptions = {
  script: string;
  baseURL: string;
  apiBaseURL: string;
  headless: boolean;
  autoContinue: boolean;
};

const STEP_TIMEOUT_MS = 20_000;

function parseArgs(argv: string[]): RunnerOptions {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--") {
      continue;
    }
    if (!key.startsWith("--")) {
      continue;
    }
    const normalized = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[normalized] = "true";
    } else {
      args[normalized] = next;
      i += 1;
    }
  }

  return {
    script: args.script ?? "e2e/guided/scripts/po_grn_guided.json",
    baseURL: args.baseURL ?? "http://localhost:1729",
    apiBaseURL:
      args.apiBaseURL ??
      process.env.E2E_API_BASE_URL ??
      "http://localhost:1730",
    headless: args.headless === "true",
    autoContinue: args.autoContinue === "true",
  };
}

function toFileSafe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestampForFolder(): string {
  const now = new Date();
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function parseValueAsSelectOption(value: unknown): {
  value?: string;
  label?: string;
  index?: number;
} {
  if (typeof value === "string") {
    return { value };
  }
  if (typeof value === "number") {
    return { index: value };
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      value?: string;
      label?: string;
      index?: number;
    };
    return candidate;
  }
  throw new Error("Select action requires value");
}

async function runReset(apiBaseURL: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseURL}/test/reset-and-seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed_minimal: false }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[WARN] reset-and-seed not available (${response.status}): ${body}`,
      );
      return false;
    }

    console.log("[INFO] Test reset-and-seed completed.");
    return true;
  } catch (error) {
    console.warn(`[WARN] Unable to call reset-and-seed: ${String(error)}`);
    return false;
  }
}

async function maybePromptCheckpoint(
  step: GuidedStep,
  stepIndex: number,
  totalSteps: number,
  autoContinue: boolean,
): Promise<boolean> {
  if (!step.checkpoint) {
    return true;
  }

  if (autoContinue) {
    console.log(
      `[CHECKPOINT ${stepIndex}/${totalSteps}] auto-continue enabled.`,
    );
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `\n[CHECKPOINT ${stepIndex}/${totalSteps}] ${step.description}\nContinue? (y/n): `,
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

async function executeStep(
  step: GuidedStep,
  page: any,
  baseURL: string,
): Promise<void> {
  page.setDefaultTimeout(STEP_TIMEOUT_MS);

  switch (step.action) {
    case "navigate": {
      const target = String(step.value ?? "");
      if (!target) {
        throw new Error("Navigate action needs value");
      }
      const url = target.startsWith("http") ? target : `${baseURL}${target}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForLoadState("networkidle");
      if (step.selector) {
        await expect(page.locator(step.selector).first()).toBeVisible();
      }
      return;
    }
    case "click": {
      if (!step.selector) {
        throw new Error("Click action needs selector");
      }
      const locator = page.locator(step.selector).first();
      await expect(locator).toBeVisible();
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      return;
    }
    case "fill": {
      if (!step.selector) {
        throw new Error("Fill action needs selector");
      }
      if (step.value === undefined || step.value === null) {
        throw new Error("Fill action needs value");
      }
      const locator = page.locator(step.selector).first();
      const textValue = String(step.value);
      await expect(locator).toBeVisible();
      await locator.fill(textValue);
      await expect(locator).toHaveValue(textValue);
      return;
    }
    case "select": {
      if (!step.selector) {
        throw new Error("Select action needs selector");
      }
      const option = parseValueAsSelectOption(step.value);
      const locator = page.locator(step.selector).first();
      await expect(locator).toBeVisible();
      const selected = await locator.selectOption(option);
      if (selected.length === 0) {
        throw new Error(
          `No option selected for selector ${step.selector}: ${JSON.stringify(option)}`,
        );
      }
      return;
    }
    case "wait": {
      const timeoutMs = Number(step.value ?? 1000);
      await page.waitForTimeout(timeoutMs);
      return;
    }
    case "expect": {
      const value = step.value as
        | string
        | {
            text?: string;
            visible?: boolean;
            urlContains?: string;
          }
        | undefined;

      if (step.selector) {
        const locator = page.locator(step.selector).first();
        if (value && typeof value === "object") {
          if (value.visible === false) {
            await expect(locator).toBeHidden();
            return;
          }
          if (typeof value.text === "string") {
            await expect(locator).toContainText(value.text);
            return;
          }
        }
        if (typeof value === "string") {
          await expect(locator).toContainText(value);
          return;
        }
        await expect(locator).toBeVisible();
        return;
      }

      if (
        value &&
        typeof value === "object" &&
        typeof value.urlContains === "string"
      ) {
        await expect(page).toHaveURL(new RegExp(value.urlContains));
        return;
      }

      throw new Error("Expect action needs selector or urlContains");
    }
    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}

async function writeHtmlReport(
  reportPath: string,
  report: RunReport,
): Promise<void> {
  const rows = report.steps
    .map((step, index) => {
      const statusColor =
        step.status === "PASS"
          ? "#0f766e"
          : step.status === "FAIL"
            ? "#b91c1c"
            : "#374151";
      const screenshot = step.screenshotPath
        ? `<a href="${step.screenshotPath}" target="_blank">view</a>`
        : "-";
      return `<tr>
        <td>${index + 1}</td>
        <td>${step.id}</td>
        <td>${step.description}</td>
        <td><span style="color:${statusColor};font-weight:600">${step.status}</span></td>
        <td>${step.durationMs}</td>
        <td>${screenshot}</td>
        <td>${step.error ? step.error.replace(/</g, "&lt;") : ""}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Guided Test Report</title>
    <style>
      body { font-family: sans-serif; margin: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #ddd; padding: 8px; font-size: 14px; vertical-align: top; }
      th { background: #f8fafc; text-align: left; }
      .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    </style>
  </head>
  <body>
    <h1>${report.name}</h1>
    <div class="meta">
      <div><strong>Script:</strong> ${report.scriptPath}</div>
      <div><strong>Base URL:</strong> ${report.baseURL}</div>
      <div><strong>Started:</strong> ${report.startedAt}</div>
      <div><strong>Ended:</strong> ${report.endedAt}</div>
      <div><strong>Duration:</strong> ${report.durationMs} ms</div>
      <div><strong>Reset:</strong> attempted=${report.resetAttempted}, succeeded=${report.resetSucceeded}</div>
      <div><strong>Summary:</strong> pass=${report.passedSteps}, fail=${report.failedSteps}, aborted=${report.aborted}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>ID</th>
          <th>Description</th>
          <th>Status</th>
          <th>Duration (ms)</th>
          <th>Screenshot</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </body>
</html>`;

  await fs.writeFile(reportPath, html, "utf-8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const scriptPath = path.isAbsolute(options.script)
    ? options.script
    : path.resolve(cwd, options.script);

  const scriptRaw = await fs.readFile(scriptPath, "utf-8");
  const script = JSON.parse(scriptRaw) as GuidedScript;

  const runStarted = new Date();
  const runFolder = path.resolve(
    cwd,
    "e2e/guided/artifacts",
    timestampForFolder(),
  );
  await fs.mkdir(runFolder, { recursive: true });

  const report: RunReport = {
    name: script.name,
    scriptPath,
    baseURL: options.baseURL,
    apiBaseURL: options.apiBaseURL,
    resetAttempted: script.resetBeforeRun !== false,
    resetSucceeded: false,
    aborted: false,
    startedAt: runStarted.toISOString(),
    endedAt: runStarted.toISOString(),
    durationMs: 0,
    totalSteps: script.steps.length,
    passedSteps: 0,
    failedSteps: 0,
    steps: [],
  };

  if (report.resetAttempted) {
    report.resetSucceeded = await runReset(options.apiBaseURL);
  }

  let browser: any;
  let fatalError: string | undefined;

  try {
    browser = await chromium.launch({ headless: options.headless });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    for (let i = 0; i < script.steps.length; i += 1) {
      const step = script.steps[i];
      const stepLabel = `[${i + 1}/${script.steps.length}] ${step.id}`;
      console.log(`\n${stepLabel}: ${step.description}`);

      const startedAt = new Date();
      const stepResult: StepResult = {
        id: step.id,
        description: step.description,
        action: step.action,
        startedAt: startedAt.toISOString(),
        endedAt: startedAt.toISOString(),
        durationMs: 0,
        status: "SKIPPED",
      };

      try {
        await executeStep(step, page, options.baseURL);

        if (step.screenshot) {
          const screenshotFile = `${String(i + 1).padStart(2, "0")}-${toFileSafe(step.id)}.png`;
          const screenshotPath = path.join(runFolder, screenshotFile);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          stepResult.screenshotPath = screenshotFile;
        }

        stepResult.status = "PASS";
        report.passedSteps += 1;
        console.log(`${stepLabel}: PASS`);

        const shouldContinue = await maybePromptCheckpoint(
          step,
          i + 1,
          script.steps.length,
          options.autoContinue,
        );
        if (!shouldContinue) {
          report.aborted = true;
          console.log(`${stepLabel}: stopped by user at checkpoint.`);
          stepResult.endedAt = new Date().toISOString();
          stepResult.durationMs =
            new Date(stepResult.endedAt).getTime() -
            new Date(stepResult.startedAt).getTime();
          report.steps.push(stepResult);
          break;
        }
      } catch (error) {
        stepResult.status = "FAIL";
        stepResult.error =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        report.failedSteps += 1;

        try {
          const failedScreenshotFile = `${String(i + 1).padStart(2, "0")}-${toFileSafe(step.id)}-failed.png`;
          const failedScreenshotPath = path.join(
            runFolder,
            failedScreenshotFile,
          );
          await page.screenshot({ path: failedScreenshotPath, fullPage: true });
          stepResult.screenshotPath = failedScreenshotFile;
        } catch {
          // Ignore screenshot failures.
        }

        console.error(`${stepLabel}: FAIL`);
        console.error(stepResult.error);
        report.steps.push(stepResult);
        break;
      }

      stepResult.endedAt = new Date().toISOString();
      stepResult.durationMs =
        new Date(stepResult.endedAt).getTime() -
        new Date(stepResult.startedAt).getTime();
      report.steps.push(stepResult);
    }
  } catch (error) {
    fatalError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    report.error = fatalError;
    report.failedSteps += 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const endedAt = new Date();
  report.endedAt = endedAt.toISOString();
  report.durationMs = endedAt.getTime() - new Date(report.startedAt).getTime();

  const reportJsonPath = path.join(runFolder, "report.json");
  const reportHtmlPath = path.join(runFolder, "report.html");
  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
  await writeHtmlReport(reportHtmlPath, report);

  console.log("\nGuided run complete.");
  console.log(`Report JSON: ${reportJsonPath}`);
  console.log(`Report HTML: ${reportHtmlPath}`);

  if (fatalError || report.failedSteps > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
