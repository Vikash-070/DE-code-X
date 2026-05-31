/**
 * OpenRouter provider adapter (OpenAI-compatible API).
 * Used server-side only — never import from client components.
 */

import OpenAI from "openai";

import {
  OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
  MAX_TOKENS
} from "@/server/ai/constants";

// Re-export canonical model for consumers that only need the type/value.
export { OPENROUTER_MODEL };

// Supported models — production-stable endpoints only.
// No :free variants — they rotate and disappear.
export type OpenRouterModel =
  | "openai/gpt-4o-mini"
  | "openai/gpt-4o"
  | "anthropic/claude-3.5-sonnet"
  | "anthropic/claude-3.5-haiku"
  | "anthropic/claude-3-haiku";

export interface OpenRouterCompletionOptions {
  model?:       OpenRouterModel;
  maxTokens?:   number;
  temperature?: number;
  system?:      string;
  jsonMode?:    boolean;
}

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://decode-x.ai",
      "X-Title":      "DE-code X"
    }
  });
}

/**
 * Run a single structured completion via OpenRouter.
 * Used by the legacy multi-agent orchestrator (orchestrator.ts).
 * New code should use the streaming route directly.
 */
export async function runOpenRouterCompletion(
  apiKey:  string,
  userPrompt: string,
  options: OpenRouterCompletionOptions = {}
): Promise<string> {
  const client = createClient(apiKey);
  const {
    model       = OPENROUTER_MODEL,
    maxTokens   = MAX_TOKENS,
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
    if (!content) throw new Error("OpenRouter returned no content");
    return content;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new Error(`OpenRouter API error ${err.status}: ${err.message}`);
    }
    throw err instanceof Error ? err : new Error("Unknown OpenRouter error");
  }
}

/**
 * Test an OpenRouter API key with a lightweight ping.
 *
 * Uses OPENROUTER_MODEL (same model as production) — ensures the key has
 * access to the exact endpoint that will be used for real requests.
 * Previous versions used meta-llama/:free which rotates and returns 404.
 */
export async function testOpenRouterKey(apiKey: string): Promise<true> {
  const client = createClient(apiKey);
  console.log(`[openrouter] ping_start model=${OPENROUTER_MODEL}`);
  try {
    await client.chat.completions.create({
      model:      OPENROUTER_MODEL,
      max_tokens: 5,
      messages:   [{ role: "user", content: "ping" }]
    });
    console.log(`[openrouter] ping_success model=${OPENROUTER_MODEL}`);
    return true;
  } catch (err) {
    const msg = err instanceof OpenAI.APIError
      ? `OpenRouter key validation failed (${err.status}): ${err.message}`
      : "Failed to connect to OpenRouter";
    console.log(`[openrouter] ping_failed err=${msg}`);
    throw new Error(msg);
  }
}
