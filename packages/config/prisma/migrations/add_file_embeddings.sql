-- ─── Phase 3: Semantic vector search ────────────────────────────────────────
-- Run this migration manually on your Supabase PostgreSQL instance.
-- Supabase has pgvector pre-installed — no extension install needed beyond enabling it.
--
-- Steps:
--   1. Go to your Supabase project → SQL Editor
--   2. Paste and run this entire script
--   3. Verify with: SELECT * FROM file_embeddings LIMIT 0;
--
-- pgvector docs: https://github.com/pgvector/pgvector

-- Enable pgvector extension (safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── file_embeddings table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_embeddings (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "repoFullName"  TEXT        NOT NULL,
  "filePath"      TEXT        NOT NULL,
  branch          TEXT        NOT NULL DEFAULT 'main',
  model           TEXT        NOT NULL,
  "embeddingText" TEXT        NOT NULL,
  -- pgvector: 1536 dims matches text-embedding-3-small output
  embedding       vector(1536),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT file_embeddings_pkey PRIMARY KEY (id)
);

-- Unique constraint: one embedding per file per branch per repo
CREATE UNIQUE INDEX IF NOT EXISTS file_embeddings_repo_file_branch_key
  ON file_embeddings ("repoFullName", "filePath", branch);

-- Covering index for repo+branch queries (used in all search/count operations)
CREATE INDEX IF NOT EXISTS file_embeddings_repo_branch_idx
  ON file_embeddings ("repoFullName", branch);

-- HNSW index for fast approximate nearest-neighbor cosine search.
-- HNSW is preferred over IVFFlat for small-to-medium datasets (< 1M vectors)
-- because it doesn't require a training step.
-- m=16: connectivity per layer (higher = better recall, more memory)
-- ef_construction=64: build-time quality parameter
CREATE INDEX IF NOT EXISTS file_embeddings_embedding_hnsw_idx
  ON file_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Verify ────────────────────────────────────────────────────────────────
-- After running, verify the table and index exist:
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'file_embeddings';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'file_embeddings';
