/**
 * Canonical AI provider constants — single source of truth.
 *
 * ALL orchestration code imports from here.
 * Never hardcode model strings elsewhere.
 */

/** The one model used for all V# orchestration. */
export const OPENROUTER_MODEL = "openai/gpt-4o-mini" as const;

/** OpenRouter API base URL (OpenAI-compatible). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1" as const;

/** Max tokens per V# response — full architectural synthesis with code context. */
export const MAX_TOKENS = 2_000 as const;

/**
 * Max tokens for single-file analyzers (Cipher / Sentinel / Pulse). Lower than
 * MAX_TOKENS because a findings JSON array is compact — and a smaller ceiling
 * keeps each paid call cheap and runnable on minimal OpenRouter credit balances
 * (the 2000 ceiling 402'd accounts with < ~2000 affordable tokens).
 */
export const ANALYZER_MAX_TOKENS = 1_200 as const;

/** Required prefix for valid OpenRouter API keys. */
export const OPENROUTER_KEY_PREFIX = "sk-or-" as const;
