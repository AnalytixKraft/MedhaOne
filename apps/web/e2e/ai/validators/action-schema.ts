import { config } from "../config.ts";
import type { DomElementSummary, DomSummary } from "../dom-extractor.ts";
import type { WorkflowDefinition } from "../engine.ts";

export type AiActionType = "click" | "type" | "select" | "wait" | "noop";

export type AiAction = {
  action: AiActionType;
  target: string;
  value?: string;
  reason: string;
};

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidActionError";
  }
}

const DESTRUCTIVE_TARGET = /\b(delete|remove|archive|destroy|deactivate|cancel)\b/i;

function normalizeAction(value: unknown): AiActionType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    normalized === "click" ||
    normalized === "press" ||
    normalized === "tap" ||
    normalized === "click_button" ||
    normalized === "click_link"
  ) {
    return "click";
  }

  if (
    normalized === "type" ||
    normalized === "fill" ||
    normalized === "input" ||
    normalized === "enter" ||
    normalized === "type_text" ||
    normalized === "fill_field"
  ) {
    return "type";
  }

  if (
    normalized === "select" ||
    normalized === "choose" ||
    normalized === "pick" ||
    normalized === "select_option"
  ) {
    return "select";
  }

  if (
    normalized === "wait" ||
    normalized === "pause" ||
    normalized === "sleep" ||
    normalized === "wait_for"
  ) {
    return "wait";
  }

  if (normalized === "noop" || normalized === "none" || normalized === "done") {
    return "noop";
  }

  return null;
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidActionError("Planner output must be a JSON object");
  }
  return raw as Record<string, unknown>;
}

function normalizePayload(raw: unknown): Record<string, unknown> {
  const payload = asRecord(raw);
  const wrapped = payload.next_action ?? payload.nextAction ?? payload.step ?? payload.command;

  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }

  const plan = payload.plan;
  if (Array.isArray(plan) && plan.length > 0 && typeof plan[0] === "object" && plan[0] !== null) {
    return plan[0] as Record<string, unknown>;
  }

  return payload;
}

function pickFirstString(
  payload: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function findTarget(domSummary: DomSummary, target: string): DomElementSummary | undefined {
  return domSummary.targets.find((entry) => entry.target === target);
}

export function validateAction(
  rawAction: unknown,
  domSummary: DomSummary,
  workflow: WorkflowDefinition,
): AiAction {
  const payload = normalizePayload(rawAction);
  const actionValue = pickFirstString(payload, ["action", "type", "tool", "command"]);
  const action = normalizeAction(actionValue);
  const target = pickFirstString(payload, ["target", "element", "selector", "field"]);
  const value = pickFirstString(payload, ["value", "input", "text", "option", "wait_ms"]);
  const reason = pickFirstString(payload, ["reason", "explanation", "why"]);

  if (!action) {
    const received = actionValue ?? JSON.stringify(rawAction);
    throw new InvalidActionError(
      `Action must be click, type, select, wait, or noop (received: ${received ?? "undefined"})`,
    );
  }

  if (typeof target !== "string" || target.length === 0) {
    throw new InvalidActionError("Action target must be a non-empty string");
  }

  if (typeof reason !== "string" || reason.length === 0) {
    throw new InvalidActionError("Action reason must be a non-empty string");
  }

  if ((action === "type" || action === "select") && (typeof value !== "string" || !value)) {
    throw new InvalidActionError(`${action} actions require a non-empty string value`);
  }

  if (action === "wait" && value !== undefined && typeof value !== "string") {
    throw new InvalidActionError("wait action value must be a string when provided");
  }

  if (action === "wait" || action === "noop") {
    return {
      action,
      target,
      value: typeof value === "string" ? value : undefined,
      reason,
    };
  }

  const element = findTarget(domSummary, target);
  if (!element) {
    throw new InvalidActionError(`Target '${target}' is not present in the current DOM summary`);
  }

  if (action === "type" && element.kind !== "input") {
    throw new InvalidActionError("type actions must target an input");
  }

  if (action === "select" && element.kind !== "select") {
    throw new InvalidActionError("select actions must target a select");
  }

  if (!workflow.allowsDestructiveActions && (element.destructive || DESTRUCTIVE_TARGET.test(target))) {
    throw new InvalidActionError("Destructive actions are blocked for this workflow");
  }

  if (action === "click" && element.kind === "link" && element.href) {
    const href = element.href.trim();
    if (/^https?:\/\//i.test(href)) {
      if (!href.startsWith(config.baseOrigin)) {
        throw new InvalidActionError("Navigation outside the application domain is blocked");
      }
    }
    if (href.startsWith("/") && !workflow.allowedPathPrefixes.some((prefix) => href.startsWith(prefix))) {
      throw new InvalidActionError("Navigation outside the workflow scope is blocked");
    }
  }

  return {
    action,
    target,
    value: typeof value === "string" ? value : undefined,
    reason,
  };
}
