/**
 * OpenAI provider adapter.
 * Used server-side only — never import from client components.
 */

import OpenAI from "openai";

export type OpenAIModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "gpt-3.5-turbo";

export interface OpenAICompletionOptions {
  model?: OpenAIModel;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  jsonMode?: boolean;
}

/**
 * Run a single structured completion via OpenAI.
 */
export async function runOpenAICompletion(
  apiKey: string,
  userPrompt: string,
  options: OpenAICompletionOptions = {}
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const {
    model       = "gpt-4o-mini",
    maxTokens   = 2048,
    temperature = 0.2,
    system,
    jsonMode    = false,
  } = options;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user", content: userPrompt }
  ];

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no content");
    return content;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new Error(`OpenAI API error ${err.status}: ${err.message}`);
    }
    throw err instanceof Error ? err : new Error("Unknown OpenAI error");
  }
}

/**
 * Test an OpenAI API key with a lightweight models list call.
 */
export async function testOpenAIKey(apiKey: string): Promise<true> {
  const client = new OpenAI({ apiKey });
  try {
    await client.models.list();
    return true;
  } catch (err) {
    const msg = err instanceof OpenAI.APIError
      ? `API key validation failed (${err.status}): ${err.message}`
      : "Failed to connect to OpenAI";
    throw new Error(msg);
  }
}
