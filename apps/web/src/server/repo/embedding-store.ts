/**
 * File Embedding Persistence Layer.
 *
 * Stores and queries vector embeddings for repository files using pgvector.
 * Powers Phase 3 semantic search — "what files handle rate limiting?"
 *
 * PRISMA + PGVECTOR CONTRACT:
 *   Prisma cannot generate typed queries for Unsupported("vector(1536)") columns.
 *   All vector read/write operations use prisma.$queryRaw / prisma.$executeRaw.
 *   Non-vector fields (metadata, timestamps) could use normal Prisma operations,
 *   but for consistency all operations in this file use raw SQL.
 *
 *   Vector literal format: '[0.1,0.2,...]' — Postgres casts $N::vector automatically.
 *   PostgreSQL parameter binding: prisma tagged template literals bind $N params safely.
 *
 * TABLE: file_embeddings (see migration: packages/config/prisma/migrations/add_file_embeddings.sql)
 * INDEX: HNSW cosine index (vector_cosine_ops) — fast approximate nearest-neighbor
 *
 * SECURITY: Vector data contains no user-identifiable information — only file path
 * semantics. apiKey is never stored here and never passed to this module.
 */

import { prisma }                    from "@/lib/prisma";
import { withRetry, withDbTimeout }  from "@/server/db/resilience";

// ─── Constants ────────────────────────────────────────────────

const DB_TIMEOUT_MS = 8_000;

// ─── Types ────────────────────────────────────────────────────

export interface SemanticMatch {
  filePath:   string;
  /** Cosine similarity: 0.0 (orthogonal) → 1.0 (identical). */
  similarity: number;
}

// ─── Write ────────────────────────────────────────────────────

/**
 * Upsert a file embedding.
 *
 * ON CONFLICT (repoFullName, filePath, branch) → replaces vector, embeddingText, model, updatedAt.
 * This makes re-analysis (when Cipher finds new findings) automatically update the embedding.
 *
 * The vector literal '[f1,f2,...]' is parameterized; Postgres casts it to vector(1536)
 * via the explicit ::vector cast in the SQL.
 */
export async function upsertFileEmbedding(params: {
  repoFullName:  string;
  filePath:      string;
  branch:        string;
  model:         string;
  embeddingText: string;
  vector:        number[];
}): Promise<void> {
  const { repoFullName, filePath, branch, model, embeddingText, vector } = params;

  // Format as pgvector literal string: "[0.123,0.456,...]"
  const vectorLiteral = `[${vector.join(",")}]`;

  await withRetry(
    () => withDbTimeout(
      // Using tagged template — all parameters are bound as $N placeholders.
      // The ::vector cast is applied to the string parameter in Postgres.
      prisma.$executeRaw`
        INSERT INTO file_embeddings (
          id,
          "repoFullName",
          "filePath",
          branch,
          model,
          "embeddingText",
          embedding,
          "createdAt",
          "updatedAt"
        )
        VALUES (
          gen_random_uuid()::text,
          ${repoFullName},
          ${filePath},
          ${branch},
          ${model},
          ${embeddingText},
          ${vectorLiteral}::vector,
          now(),
          now()
        )
        ON CONFLICT ("repoFullName", "filePath", branch)
        DO UPDATE SET
          embedding       = ${vectorLiteral}::vector,
          "embeddingText" = ${embeddingText},
          model           = ${model},
          "updatedAt"     = now()
      `,
      DB_TIMEOUT_MS
    ),
    { label: "embedding_store.upsert", maxAttempts: 3 }
  );
}

// ─── Read ─────────────────────────────────────────────────────

/**
 * Find the top-K files most semantically similar to a query vector.
 *
 * Uses pgvector's `<=>` operator (cosine distance).
 * Returns files sorted by similarity DESC (most relevant first).
 *
 * The HNSW index makes this O(log n) in practice, not O(n).
 *
 * @param repoFullName  — "owner/repo" (exact match, indexed)
 * @param branch        — Branch name
 * @param queryVector   — 1536-dim query embedding from generateEmbedding()
 * @param topK          — Maximum results to return (default 10)
 * @param minSimilarity — Minimum cosine similarity threshold (default 0.35)
 *                        Below this, results are too unrelated to be useful.
 */
export async function searchByVector(params: {
  repoFullName:   string;
  branch:         string;
  queryVector:    number[];
  topK?:          number;
  minSimilarity?: number;
}): Promise<SemanticMatch[]> {
  const {
    repoFullName,
    branch,
    queryVector,
    topK          = 10,
    minSimilarity = 0.35,
  } = params;

  const vectorLiteral = `[${queryVector.join(",")}]`;

  // cosine similarity = 1 - cosine_distance
  // pgvector's <=> operator returns distance (0=identical, 2=opposite for cosine).
  // We filter by similarity >= minSimilarity and order by distance ASC.
  const rows = await withDbTimeout(
    prisma.$queryRaw<Array<{ filePath: string; similarity: number }>>`
      SELECT
        "filePath",
        (1 - (embedding <=> ${vectorLiteral}::vector))::float8 AS similarity
      FROM file_embeddings
      WHERE
        "repoFullName" = ${repoFullName}
        AND branch = ${branch}
        AND embedding IS NOT NULL
        AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${minSimilarity}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `,
    DB_TIMEOUT_MS
  );

  return rows.map(r => ({
    filePath:   r.filePath,
    // Postgres numeric → JS number: prisma $queryRaw returns BigInt or string for some numeric types
    similarity: typeof r.similarity === "number"
      ? r.similarity
      : parseFloat(String(r.similarity)),
  }));
}

/**
 * Count how many files have embeddings for a given repo+branch.
 *
 * Used before triggering semantic search to skip the query entirely
 * when Cipher hasn't analyzed any files yet (count === 0).
 */
export async function countEmbeddings(
  repoFullName: string,
  branch:       string
): Promise<number> {
  const rows = await withDbTimeout(
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM file_embeddings
      WHERE
        "repoFullName" = ${repoFullName}
        AND branch     = ${branch}
        AND embedding  IS NOT NULL
    `,
    DB_TIMEOUT_MS
  );

  return Number(rows[0]?.count ?? 0);
}
