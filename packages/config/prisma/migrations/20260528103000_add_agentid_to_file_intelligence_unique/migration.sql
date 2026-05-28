-- Migration: add agentId to file_intelligence unique constraint
--
-- Before: UNIQUE (repoFullName, filePath, branch)
--   → One record per file per branch. Sentinel analyzing auth/route.ts
--     OVERWRITES Cipher's findings for the same file.
--
-- After: UNIQUE (repoFullName, filePath, branch, agentId)
--   → One record per file per branch PER MODULE. Each module keeps its own findings.
--
-- This is a prerequisite for any multi-module code to ship.

-- Drop old 3-field constraint
DROP INDEX IF EXISTS "file_intelligence_repoFullName_filePath_branch_key";

-- Add new 4-field constraint (includes agentId)
CREATE UNIQUE INDEX "file_intelligence_repoFullName_filePath_branch_agentId_key"
  ON "file_intelligence"("repoFullName", "filePath", "branch", "agentId");
