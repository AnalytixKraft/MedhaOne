import OpenAI from "openai";

const MODEL = process.env.AI_AGENT_OPENAI_MODEL ?? "gpt-4.1-mini";
const MAX_OUTPUT_TOKENS = 800;

function modeTemperature(mode: string): number {
  if (mode === "acceptance") {
    return 0.2;
  }
  if (mode === "regression") {
    return 0.3;
  }
  return 0.7;
}

function parseJsonResponse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("LLM returned empty response");
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(withoutFence);
}

async function requestOnce(
  client: OpenAI,
  prompt: string,
  mode: string,
  retryHint = "",
): Promise<unknown> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: modeTemperature(mode),
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a UI testing planning model. Return only valid JSON object.",
      },
      {
        role: "user",
        content: `${prompt}${retryHint}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return parseJsonResponse(content);
}

export async function askLLM(prompt: string, mode: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const client = new OpenAI({ apiKey });
  try {
    return await requestOnce(client, prompt, mode);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return requestOnce(
        client,
        prompt,
        mode,
        "\n\nPrevious response was invalid JSON. Return strictly valid JSON only.",
      );
    }
    throw error;
  }
}

