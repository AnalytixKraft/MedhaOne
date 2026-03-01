import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

import { validateAction, type AgentAction } from "./action-validator";
import { summarizePage, type DOMSummary } from "./dom-summarizer";
import { executeAction } from "./executor";
import { validateInvariants } from "./invariants";
import { buildAcceptancePrompt, isAcceptanceGoalAchieved } from "./modes/acceptance";
import { buildChaosPrompt, isChaosGoalAchieved } from "./modes/chaos";
import { buildRegressionPrompt, isRegressionGoalAchieved } from "./modes/regression";
import { askLLM } from "./openai";

type AgentMode = "acceptance" | "regression" | "chaos";
type StopReason =
  | "goal_achieved"
  | "step_limit_reached"
  | "fatal_error"
  | "consecutive_failures";

type StepLog = {
  step: number;
  mode: AgentMode;
  prompt: string;
  domSummary: DOMSummary;
  rawAction: unknown;
  action?: AgentAction;
  success: boolean;
  attempts: number;
  screenshotPath?: string;
  error?: string;
  invariantFailures?: string[];
};

type RunReport = {
  mode: AgentMode;
  startTime: string;
  endTime: string;
  durationMs: number;
  maxSteps: number;
  totalSteps: number;
  totalFailures: number;
  totalSuccess: number;
  stopReason: StopReason;
  resetStatus: "ok" | "failed";
  steps: StepLog[];
  fatalError?: string;
};

const MAX_STEPS = 50;
const MAX_RETRIES_PER_STEP = 2;
const STEP_TIMEOUT_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BASE_URL = process.env.AI_AGENT_BASE_URL ?? "http://localhost:1729";
const HEADLESS = process.env.AI_AGENT_HEADED === "true" ? false : true;

function nowTag(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function parseMode(value: string | undefined): AgentMode {
  if (value === "regression" || value === "chaos") {
    return value;
  }
  return "acceptance";
}

function ensureAgentGuards(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("AI test agent is blocked in production environment");
  }
  if (process.env.ENABLE_AI_TEST_AGENT !== "true") {
    throw new Error("ENABLE_AI_TEST_AGENT must be true to run AI test agent");
  }
}

async function resetTestDatabase(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/test/reset-and-seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed_minimal: false }),
  });
  if (!response.ok) {
    throw new Error(`reset-and-seed failed: ${response.status} ${await response.text()}`);
  }
}

function buildPrompt(mode: AgentMode, summary: DOMSummary, step: number, transcript: string[]): string {
  if (mode === "regression") {
    return buildRegressionPrompt(summary, step, transcript);
  }
  if (mode === "chaos") {
    return buildChaosPrompt(summary, step, transcript);
  }
  return buildAcceptancePrompt(summary, step, transcript);
}

async function isGoalAchieved(mode: AgentMode, page: Parameters<typeof isAcceptanceGoalAchieved>[0]): Promise<boolean> {
  if (mode === "regression") {
    return isRegressionGoalAchieved(page);
  }
  if (mode === "chaos") {
    return isChaosGoalAchieved(page);
  }
  return isAcceptanceGoalAchieved(page);
}

async function writeSummaryHtml(reportPath: string, report: RunReport): Promise<void> {
  const rows = report.steps
    .map(
      (step) => `<tr>
  <td>${step.step}</td>
  <td>${step.success ? "PASS" : "FAIL"}</td>
  <td>${step.action?.action ?? "-"}</td>
  <td>${step.action?.target ?? "-"}</td>
  <td>${step.attempts}</td>
  <td>${step.error ?? ""}</td>
</tr>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>AI Agent Summary</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background: #f3f4f6; }
    </style>
  </head>
  <body>
    <h1>AI Agent Run (${report.mode})</h1>
    <p>Start: ${report.startTime}</p>
    <p>End: ${report.endTime}</p>
    <p>Stop reason: ${report.stopReason}</p>
    <p>Success: ${report.totalSuccess} / ${report.totalSteps}</p>
    <table>
      <thead>
        <tr><th>Step</th><th>Status</th><th>Action</th><th>Target</th><th>Attempts</th><th>Error</th></tr>
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
  ensureAgentGuards();

  const mode = parseMode(process.env.AI_AGENT_MODE);
  const start = new Date();
  const runId = nowTag();

  const rootDir = path.resolve(process.cwd(), "e2e/ai-agent");
  const artifactDir = path.join(rootDir, "artifacts", runId);
  const reportDir = path.join(rootDir, "reports", runId);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });

  const transcript: string[] = [];
  const steps: StepLog[] = [];

  let resetStatus: "ok" | "failed" = "ok";
  try {
    await resetTestDatabase(BASE_URL);
    transcript.push("DB reset: OK");
  } catch (error) {
    resetStatus = "failed";
    throw new Error(`DB reset failed: ${String(error)}`);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let totalFailures = 0;
  let totalSuccess = 0;
  let consecutiveFailures = 0;
  let stopReason: StopReason = "step_limit_reached";
  let fatalError: string | undefined;

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const domSummary = await summarizePage(page);
      const prompt = buildPrompt(mode, domSummary, step, transcript);
      transcript.push(`STEP ${step} PROMPT:\n${prompt}`);

      let rawAction: unknown;
      let action: AgentAction | undefined;
      let success = false;
      let attempts = 0;
      let screenshotPath: string | undefined;
      let errorMessage: string | undefined;
      let invariantFailures: string[] | undefined;

      try {
        rawAction = await askLLM(prompt, mode);
        action = validateAction(rawAction, domSummary);
      } catch (error) {
        rawAction = null;
        errorMessage = `Planning failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (action) {
        for (let attempt = 1; attempt <= MAX_RETRIES_PER_STEP; attempt += 1) {
          attempts = attempt;
          const execution = await executeAction(page, action, {
            stepNumber: step,
            timeoutMs: STEP_TIMEOUT_MS,
            artifactDir,
          });
          screenshotPath = execution.screenshotPath;
          if (execution.ok) {
            success = true;
            break;
          }
          errorMessage = execution.error;
        }
      }

      if (success) {
        totalSuccess += 1;
        consecutiveFailures = 0;
      } else {
        totalFailures += 1;
        consecutiveFailures += 1;
      }

      const stepLog: StepLog = {
        step,
        mode,
        prompt,
        domSummary,
        rawAction: rawAction ?? null,
        action,
        success,
        attempts,
        screenshotPath,
        error: errorMessage,
      };

      if (mode === "regression" && step % 5 === 0) {
        const invariantResult = await validateInvariants(page);
        if (!invariantResult.passed) {
          invariantFailures = invariantResult.failures;
          stepLog.invariantFailures = invariantFailures;
          success = false;
          totalFailures += 1;
          consecutiveFailures += 1;
          transcript.push(
            `STEP ${step} INVARIANT FAILURES: ${JSON.stringify(invariantResult.failures)}`,
          );
        }
      }

      steps.push(stepLog);
      transcript.push(
        `STEP ${step} RESULT: ${success ? "PASS" : "FAIL"} ${errorMessage ? `| ${errorMessage}` : ""}`,
      );

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopReason = "consecutive_failures";
        break;
      }

      if (await isGoalAchieved(mode, page)) {
        stopReason = "goal_achieved";
        break;
      }
    }
  } catch (error) {
    stopReason = "fatal_error";
    fatalError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await browser.close();
  }

  const end = new Date();
  const report: RunReport = {
    mode,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    durationMs: end.getTime() - start.getTime(),
    maxSteps: MAX_STEPS,
    totalSteps: steps.length,
    totalFailures,
    totalSuccess,
    stopReason,
    resetStatus,
    steps,
    fatalError,
  };

  const reportJsonPath = path.join(reportDir, "report.json");
  const reportHtmlPath = path.join(reportDir, "summary.html");
  const transcriptPath = path.join(reportDir, "transcript.txt");

  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
  await writeSummaryHtml(reportHtmlPath, report);
  await fs.writeFile(transcriptPath, transcript.join("\n\n"), "utf-8");

  console.log(`AI agent mode: ${mode}`);
  console.log(`Report: ${reportJsonPath}`);
  console.log(`Summary: ${reportHtmlPath}`);
  console.log(`Transcript: ${transcriptPath}`);

  if (stopReason === "fatal_error" || stopReason === "consecutive_failures") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

