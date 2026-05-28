/**
 * Embedding provider adapter.
 *
 * Generates dense vector representations used for semantic search.
 * Currently supports OpenAI text-embedding-3-small (1536 dims, $0.02/1M tokens).
 *
 * Anthropic does not have a public embeddings API.
 * OpenRouter proxies chat completions only — not embeddings.
 * So embeddings are only available when the user has an OpenAI key.
 *
 * SECURITY: apiKey never leaves this module. Never log or return it.
 */

import OpenAI from "openai";
import type { CipherFinding } from "@/types/intelligence";

// ─── Constants ────────────────────────────────────────────────

/** OpenAI embedding model. 1536-dim output, cheapest/fastest option. */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Dimensions for text-embedding-3-small. Must match migration's vector(1536). */
export const EMBEDDING_DIMS = 1536;

/** Maximum input characters for embedding (token budget guard: ~2K tokens). */
const MAX_EMBED_CHARS = 8_000;

// ─── Embedding generation ─────────────────────────────────────

/**
 * Generate a vector embedding for a text string using OpenAI.
 *
 * @param text   — The text to embed (will be truncated to MAX_EMBED_CHARS)
 * @param apiKey — User's OpenAI API key (decrypted, server-side only)
 * @returns A 1536-element float array
 * @throws Error with provider status code on API failure
 */
export async function generateEmbedding(
  text:   string,
  apiKey: string
): Promise<number[]> {
  const client = new OpenAI({ apiKey });

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, MAX_EMBED_CHARS),
    });

    const vector = response.data[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Embedding returned unexpected dimensions: expected ${EMBEDDING_DIMS}, got ${vector?.length ?? 0}`
      );
    }
    return vector;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new Error(`Embedding API error (${err.status}): ${err.message}`);
    }
    throw err instanceof Error ? err : new Error("Unknown embedding error");
  }
}

// ─── Embedding text construction ──────────────────────────────

/**
 * Build the text to embed for a repository file.
 *
 * Combines path + domain + finding summaries to produce a semantically rich
 * representation of what the file actually DOES (not just where it lives).
 *
 * This allows queries like "what files handle rate limiting?" to match
 * src/middleware/throttle.ts even if "rate" never appears in the path.
 *
 * Kept under ~500 tokens to minimise cost and latency.
 *
 * @param filePath  — Relative path from repo root ("src/server/auth/guards.ts")
 * @param domain    — Architectural domain from buildDomainMap() ("Auth Layer")
 * @param findings  — Cipher findings for this file (may be empty)
 */
export function buildEmbeddingText(params: {
  filePath: string;
  domain?:  string;
  findings: CipherFinding[];
}): string {
  const { filePath, domain, findings } = params;

  const parts: string[] = [`File: ${filePath}`];

  if (domain) {
    parts.push(`Domain: ${domain}`);
  }

  if (findings.length > 0) {
    // Top 6 findings: type, title, and first 180 chars of description
    const findingTexts = findings.slice(0, 6).map(f =>
      `${f.type}: ${f.title}. ${f.description.slice(0, 180)}`
    );
    parts.push(`Findings:\n${findingTexts.join("\n")}`);
  } else {
    // No findings yet — derive semantic context from the path alone.
    // Split path into words: "src/server/auth/guards.ts" → "src server auth guards ts"
    const pathWords = filePath
      .replace(/\.(ts|tsx|js|jsx|py|go|rs|sql|yaml|yml|json)$/, "") // strip extension
      .split(/[/\-_.]+/)                                             // split on path separators + delimiters
      .filter(Boolean)
      .join(" ");
    parts.push(`Path context: ${pathWords}`);
  }

  return parts.join("\n");
}
