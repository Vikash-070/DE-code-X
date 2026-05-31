/**
 * Google Gemini provider adapter (OpenAI-compatible endpoint).
 *
 * Gemini exposes an OpenAI-compatible REST API at
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 * so we reuse the `openai` SDK pointed at that base URL — same pattern as the
 * OpenRouter adapter, zero new dependencies.
 *
 * Server-side only — never import from client components.
 */

import OpenAI from "openai";

/** OpenAI-compatible Gemini endpoint. */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai" as const;

/** Default model — balanced cost/quality for code analysis. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash" as const;

/** Required prefix for Google AI Studio API keys. */
export const GEMINI_KEY_PREFIX = "AIza" as const;

/**
 * Supported Gemini models — production-stable IDs only. Free-tier models
 * (flash variants) are included so users on the AI Studio free plan can use
 * the integration without billing.
 */
export type GeminiModel =
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-2.0-flash"
  | "gemini-2.0-flash-lite"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash";

export interface GeminiCompletionOptions {
  model?:       GeminiModel | string;
  maxTokens?:   number;
  temperature?: number;
  system?:      string;
  /** When true, request a JSON-only response. Forces parseable structure. */
  jsonMode?:    boolean;
}

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GEMINI_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://decode-x.ai",
      "X-Title":      "DE-code X",
    },
  });
}

/**
 * Run a single structured completion via Gemini.
 */
export async function runGeminiCompletion(
  apiKey:      string,
  userPrompt:  string,
  options:     GeminiCompletionOptions = {}
): Promise<string> {
  const client = createClient(apiKey);
  const {
    model       = GEMINI_DEFAULT_MODEL,
    maxTokens   = 2048,
    temperature = 0.2,
    system,
    jsonMode    = false,
  } = options;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user", content: userPrompt },
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
    if (!content) throw new Error("Gemini returned no content");
    return content;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new Error(`Gemini API error ${err.status}: ${err.message}`);
    }
    throw err instanceof Error ? err : new Error("Unknown Gemini error");
  }
}

/**
 * Test a Gemini API key with a tiny ping.
 * Hits the same model the production flow uses so plan/access errors surface here.
 */
export async function testGeminiKey(apiKey: string): Promise<true> {
  const client = createClient(apiKey);
  console.log(`[gemini] ping_start model=${GEMINI_DEFAULT_MODEL}`);
  try {
    await client.chat.completions.create({
      model:      GEMINI_DEFAULT_MODEL,
      max_tokens: 5,
      messages:   [{ role: "user", content: "ping" }],
    });
    console.log(`[gemini] ping_success model=${GEMINI_DEFAULT_MODEL}`);
    return true;
  } catch (err) {
    const msg = err instanceof OpenAI.APIError
      ? `Gemini key validation failed (${err.status}): ${err.message}`
      : "Failed to connect to Gemini";
    console.log(`[gemini] ping_failed err=${msg}`);
    throw new Error(msg);
  }
}
