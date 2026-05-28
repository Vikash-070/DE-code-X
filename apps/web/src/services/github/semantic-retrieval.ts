/**
 * Semantic retrieval — Phase 3 fallback.
 *
 * Called from orchestrate/route.ts when all other retrieval paths return null:
 *   - No explicit file references in the message
 *   - No keyword inventory matches (Phase 2)
 *   - Normal tree search found nothing
 *
 * Pipeline:
 *   1. Check if any embeddings exist for this repo+branch (cheap COUNT query)
 *   2. Embed the user's message using OpenAI text-embedding-3-small
 *   3. Run pgvector cosine similarity search across file_embeddings
 *   4. Return matching paths as a CodeContext with searchMode: "semantic"
 *
 * Returns null if:
 *   - No embeddings exist (Cipher hasn't analyzed any files yet)
 *   - Embedding generation fails (API error, invalid key)
 *   - No matches above the similarity threshold (0.35)
 *   - Any other error (never throws — degrades gracefully)
 *
 * SECURITY:
 *   - openAiKey is decrypted server-side by caller; never logged here.
 *   - queryVector is never persisted — used for search only.
 *   - File paths returned are repo-scoped (repoFullName enforced in SQL).
 */

import { generateEmbedding }                       from "@/server/ai/providers/embeddings";
import { searchByVector, countEmbeddings }         from "@/server/repo/embedding-store";
import type { CodeContext, RepoContextInput }       from "@/server/ai/vhash-prompt";

// ─── Types ────────────────────────────────────────────────────

export interface SemanticRetrievalConfig {
  /** Decrypted OpenAI API key — server-side only. */
  openAiKey: string;
  /** Branch name to search (usually ctx.defaultBranch ?? "main"). */
  branch:    string;
}

// ─── Entry point ──────────────────────────────────────────────

/**
 * Build a semantic retrieval CodeContext for the user's message.
 *
 * Embeds the message and finds the most semantically similar analyzed files.
 * The result is a paths-only CodeContext — no file content is fetched.
 * V# renders it as a "Semantic Search Results" block and offers to retrieve specifics.
 *
 * @param message — The user's full current message
 * @param ctx     — Repository context (fullName, defaultBranch)
 * @param config  — OpenAI key + branch
 */
export async function buildSemanticRetrievalContext(
  message: string,
  ctx:     RepoContextInput,
  config:  SemanticRetrievalConfig
): Promise<CodeContext | null> {
  const { openAiKey, branch } = config;
  const { fullName: repoFullName } = ctx;

  try {
    // ── 1. Guard: any embeddings for this repo? ────────────────
    // Cheap COUNT(*) — skips embedding API call entirely if nothing is indexed.
    const count = await countEmbeddings(repoFullName, branch);
    if (count === 0) {
      console.log(
        `[semantic] no_embeddings repo=${repoFullName} branch=${branch}` +
        ` — skipping (Cipher hasn't analyzed any files yet)`
      );
      return null;
    }

    // ── 2. Embed the user's query ──────────────────────────────
    // Use up to 500 chars — captures the query intent without padding noise.
    const queryText = message.trim().slice(0, 500);
    const queryVector = await generateEmbedding(queryText, openAiKey);

    // ── 3. Vector similarity search ───────────────────────────
    const matches = await searchByVector({
      repoFullName,
      branch,
      queryVector,
      topK:          8,
      minSimilarity: 0.35,
    });

    if (matches.length === 0) {
      console.log(
        `[semantic] no_matches` +
        ` query="${queryText.slice(0, 60).replace(/\n/g, " ")}..."` +
        ` repo=${repoFullName}` +
        ` indexed=${count}`
      );
      return null;
    }

    const topPath = matches[0]!;
    console.log(
      `[semantic] matches=${matches.length}` +
      ` top=${topPath.filePath}(${topPath.similarity.toFixed(3)})` +
      ` repo=${repoFullName}` +
      ` indexed=${count}`
    );

    const paths = matches.map(m => m.filePath);

    // ── 4. Return as paths-only CodeContext ────────────────────
    // searchMode: "semantic" → triggers the "Semantic Search Results" prompt block
    // in buildVHashSystemPromptWithContext (vhash-prompt.ts).
    return {
      files:           [],
      folderListing:   paths,
      folderPrefix:    queryText.slice(0, 80),
      searchMode:      "semantic",
      retrievalStatus: "folder_listed",
      treeQuery:       queryText,
    };
  } catch (err) {
    console.error(
      `[semantic] retrieval_failed repo=${repoFullName}`,
      err instanceof Error ? err.message : String(err)
    );
    return null; // Never throw — semantic search is a best-effort fallback
  }
}
