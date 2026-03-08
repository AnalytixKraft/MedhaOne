import path from "node:path";

import dotenv from "dotenv";

export type AiTestMode = "acceptance" | "regression" | "chaos";
export type AiWorkflowName =
  | "login"
  | "masters"
  | "purchase"
  | "stock_adjustment"
  | "org_e2e";

export type AiTestConfig = {
  enabled: boolean;
  baseUrl: string;
  baseOrigin: string;
  mode: AiTestMode;
  workflow: AiWorkflowName;
  orgMaxUsers: number;
  persistData: boolean;
  headless: boolean;
  maxSteps: number;
  model: string;
  timeoutMs: number;
  openAiApiKey: string;
  artifactsRoot: string;
};

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const VALID_MODES: AiTestMode[] = ["acceptance", "regression", "chaos"];
const VALID_WORKFLOWS: AiWorkflowName[] = [
  "login",
  "masters",
  "purchase",
  "stock_adjustment",
  "org_e2e",
];

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be 'true' or 'false'`);
}

function readInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function readMode(): AiTestMode {
  const raw = process.env.AI_TEST_MODE?.trim() ?? "acceptance";
  if (!VALID_MODES.includes(raw as AiTestMode)) {
    throw new Error(`AI_TEST_MODE must be one of: ${VALID_MODES.join(", ")}`);
  }
  return raw as AiTestMode;
}

function readWorkflow(): AiWorkflowName {
  const raw = process.env.AI_TEST_WORKFLOW?.trim() ?? "login";
  if (!VALID_WORKFLOWS.includes(raw as AiWorkflowName)) {
    throw new Error(`AI_TEST_WORKFLOW must be one of: ${VALID_WORKFLOWS.join(", ")}`);
  }
  return raw as AiWorkflowName;
}

function readBaseUrl(): { baseUrl: string; baseOrigin: string } {
  const baseUrl = process.env.AI_TEST_BASE_URL?.trim() || "http://localhost:1729";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("AI_TEST_BASE_URL must be a valid absolute URL");
  }
  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    baseOrigin: parsed.origin,
  };
}

function buildConfig(): AiTestConfig {
  const enabled = readBoolean("AI_TEST_ENABLED", false);
  const { baseUrl, baseOrigin } = readBaseUrl();
  const mode = readMode();
  const workflow = readWorkflow();
  const orgMaxUsers = readInteger("AI_TEST_ORG_MAX_USERS", 10, 1);
  const persistData = readBoolean("AI_TEST_PERSIST_DATA", false);
  const headless = readBoolean("AI_TEST_HEADLESS", true);
  const maxSteps = readInteger("AI_TEST_MAX_STEPS", 40, 1);
  const timeoutMs = readInteger("AI_TEST_TIMEOUT_MS", 60_000, 1_000);
  const model = process.env.AI_TEST_MODEL?.trim() || "gpt-4o-mini";

  if (!enabled) {
    return {
      enabled,
      baseUrl,
      baseOrigin,
      mode,
      workflow,
      orgMaxUsers,
      persistData,
      headless,
      maxSteps,
      model,
      timeoutMs,
      openAiApiKey: "",
      artifactsRoot: path.resolve(process.cwd(), "apps/web/e2e/ai/artifacts"),
    };
  }

  return {
    enabled,
    baseUrl,
    baseOrigin,
    mode,
    workflow,
    orgMaxUsers,
    persistData,
    headless,
    maxSteps,
    model,
    timeoutMs,
    openAiApiKey: readRequired("OPENAI_API_KEY"),
    artifactsRoot: path.resolve(process.cwd(), "apps/web/e2e/ai/artifacts"),
  };
}

export const config: AiTestConfig = buildConfig();
