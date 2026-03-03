import OpenAI from "openai";

import { config } from "./config.ts";

export class InvalidPlannerOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlannerOutputError";
  }
}

let client: OpenAI | null = null;

const ACTION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "ai_test_action",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["click", "type", "select", "wait", "noop"],
        },
        target: {
          type: "string",
        },
        value: {
          type: ["string", "null"],
        },
        reason: {
          type: "string",
        },
      },
      required: ["action", "target", "value", "reason"],
    },
  },
} as const;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.openAiApiKey });
  }
  return client;
}

function parseJsonPayload(raw: string): unknown {
  const normalized = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  if (!normalized) {
    throw new InvalidPlannerOutputError("OpenAI returned an empty response");
  }

  try {
    return JSON.parse(normalized);
  } catch {
    throw new InvalidPlannerOutputError("OpenAI returned invalid JSON");
  }
}

async function requestOnce(prompt: string, repairHint = ""): Promise<unknown> {
  const completion = await getClient().chat.completions.create({
    model: config.model,
    temperature: config.mode === "chaos" ? 0.6 : 0.2,
    max_tokens: 500,
    response_format: ACTION_RESPONSE_FORMAT,
    messages: [
      {
        role: "system",
        content:
          "You are a Playwright testing planner. Return exactly one valid JSON object that matches the requested schema.",
      },
      {
        role: "user",
        content: `${prompt}${repairHint}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return parseJsonPayload(content);
}

export async function requestPlannerAction(prompt: string): Promise<unknown> {
  try {
    return await requestOnce(prompt);
  } catch (error) {
    if (!(error instanceof InvalidPlannerOutputError)) {
      throw error;
    }
  }

  return requestOnce(
    prompt,
    "\n\nYour previous response was invalid. Retry once and return only a valid JSON object.",
  );
}
