/**
 * Anthropic provider adapter.
 * Used server-side only — never import from client components.
 */

import Anthropic from "@anthropic-ai/sdk";

export type AnthropicModel =
  | "claude-opus-4-5"
  | "claude-sonnet-4-5"
  | "claude-haiku-3-5"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-haiku-20241022";

export interface AnthropicCompletionOptions {
  model?: AnthropicModel;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

/**
 * Run a single structured completion and return the text content.
 * Throws on API error with a normalized error message.
 */
export async function runAnthropicCompletion(
  apiKey: string,
  userPrompt: string,
  options: AnthropicCompletionOptions = {}
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const {
    model       = "claude-haiku-3-5",
    maxTokens   = 2048,
    temperature = 0.2,
    system
  } = options;

  try {
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: userPrompt }]
    });

    const block = message.content[0];
    if (!block || block.type !== "text") {
      throw new Error("Anthropic returned no text content");
    }
    return block.text;
  } catch (err) {
    const msg = err instanceof Anthropic.APIError
      ? `Anthropic API error ${err.status}: ${err.message}`
      : err instanceof Error
        ? err.message
        : "Unknown Anthropic error";
    throw new Error(msg);
  }
}

/**
 * Test an Anthropic API key with a lightweight ping.
 * Returns true on success, throws on failure.
 */
export async function testAnthropicKey(apiKey: string): Promise<true> {
  const client = new Anthropic({ apiKey });
  try {
    await client.messages.create({
      model: "claude-haiku-3-5",
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }]
    });
    return true;
  } catch (err) {
    const msg = err instanceof Anthropic.APIError
      ? `API key validation failed (${err.status}): ${err.message}`
      : "Failed to connect to Anthropic";
    throw new Error(msg);
  }
}
