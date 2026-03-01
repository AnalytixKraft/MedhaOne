import type { DOMSummary } from "./dom-summarizer";

export type AllowedAction = "click" | "fill" | "select" | "navigate" | "assert";

export type AgentAction = {
  action: AllowedAction;
  target: string;
  value?: string;
  reason: string;
};

const ALLOWED_ACTIONS: AllowedAction[] = [
  "click",
  "fill",
  "select",
  "navigate",
  "assert",
];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LLM action must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function parseRawAction(rawAction: unknown): Record<string, unknown> {
  if (typeof rawAction === "string") {
    try {
      return asObject(JSON.parse(rawAction));
    } catch {
      throw new Error("LLM action is not valid JSON");
    }
  }
  return asObject(rawAction);
}

export function validateAction(
  rawAction: unknown,
  domSummary: DOMSummary,
): AgentAction {
  const actionObject = parseRawAction(rawAction);
  const action = actionObject.action;
  const target = actionObject.target;
  const value = actionObject.value;
  const reason = actionObject.reason;

  if (typeof action !== "string" || !ALLOWED_ACTIONS.includes(action as AllowedAction)) {
    throw new Error("Action is not in allowed whitelist");
  }

  if (typeof target !== "string" || target.trim().length === 0) {
    throw new Error("Action target is required");
  }

  if (!domSummary.availableTestIds.includes(target)) {
    throw new Error(`Target '${target}' not found in visible DOM summary`);
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("Action reason is required");
  }

  if (action === "fill" || action === "select" || action === "navigate") {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${action} action requires non-empty string value`);
    }
  }

  if (action === "assert" && value !== undefined && typeof value !== "string") {
    throw new Error("assert action value must be a string when provided");
  }

  return {
    action: action as AllowedAction,
    target,
    value: typeof value === "string" ? value : undefined,
    reason,
  };
}

