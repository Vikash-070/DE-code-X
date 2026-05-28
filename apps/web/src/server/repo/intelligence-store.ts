/**
 * Repository Intelligence Persistence Layer.
 *
 * Reads and writes FileIntelligence + RepositorySnapshot records via Prisma.
 * All writes go through withRetry() + withDbTimeout() from db/resilience.ts.
 *
 * Deduplication contract:
 *   FileIntelligence has a @@unique([repoFullName, filePath, branch, agentId]) constraint.
 *   Each intelligence module (cipher, sentinel, pulse, atlas) keeps its own row
 *   for the same file — modules never overwrite each other's findings.
 *   upsertFileIntelligence() uses upsert — same (file+branch+agentId) = update, new = insert.
 *   If blobSHA is unchanged, the caller should skip re-analysis (see getFreshIntelligence()).
 *
 * SECURITY: No user data leaks through this layer. repoFullName is stored as
 * provided by the caller (already validated by the API route).
 */

import { prisma }                    from "@/lib/prisma";
import { withRetry, withDbTimeout }  from "@/server/db/resilience";
import type { CipherFinding, SnapshotEntry } from "@/types/intelligence";

// ─── Constants ────────────────────────────────────────────────

/** Hard timeout for any single DB operation in this module. */
const DB_TIMEOUT_MS = 8_000;

/** Maximum snapshot entries stored (large monorepos protection). */
const MAX_SNAPSHOT_ENTRIES = 10_000;

// ─── File Intelligence ────────────────────────────────────────

export interface StoredFileIntelligence {
  id:           string;
  repoFullName: string;
  filePath:     string;
  blobSHA:      string;
  branch:       string;
  agentId:      string;
  findings:     CipherFinding[];
  nodeIds:      string[];
  confidence:   string;
  analyzedAt:   Date;
  updatedAt:    Date;
  version:      number;
}

// Prisma stores Json as an opaque type. We double-cast via unknown.
function toFindings(raw: unknown): CipherFinding[] {
  return raw as unknown as CipherFinding[];
}
function toSnapshotEntries(raw: unknown): SnapshotEntry[] {
  return raw as unknown as SnapshotEntry[];
}

/**
 * Check whether a stored record is still fresh (blobSHA unchanged).
 * Returns the stored record if fresh, null if stale or missing.
 *
 * agentId scopes the lookup to a specific module — each module keeps its own record.
 * Defaults to "cipher" for backward compatibility with existing callers.
 */
export async function getFreshIntelligence(
  repoFullName:   string,
  filePath:       string,
  branch:         string,
  currentBlobSHA: string,
  agentId:        string = "cipher"
): Promise<StoredFileIntelligence | null> {
  const record = await withDbTimeout(
    prisma.fileIntelligence.findUnique({
      where: {
        repoFullName_filePath_branch_agentId: { repoFullName, filePath, branch, agentId }
      }
    }),
    DB_TIMEOUT_MS
  );

  if (!record) return null;
  if (record.blobSHA !== currentBlobSHA) return null; // stale

  return {
    ...record,
    findings: toFindings(record.findings),
  };
}

/**
 * Upsert a FileIntelligence record.
 * If an existing record exists (same repoFullName+filePath+branch+agentId):
 *   - updates blobSHA, findings, nodeIds, confidence, version++
 * If no record exists:
 *   - inserts fresh record
 *
 * agentId is required — each module maintains its own record per file.
 * Modules never overwrite each other (cipher and sentinel both analyse auth/route.ts
 * independently; each has its own row).
 *
 * Returns { record, wasDeduped }.
 */
export async function upsertFileIntelligence(params: {
  repoFullName: string;
  filePath:     string;
  blobSHA:      string;
  branch:       string;
  agentId:      string;
  findings:     CipherFinding[];
  nodeIds:      string[];
  confidence:   "strong" | "partial";
}): Promise<{ record: StoredFileIntelligence; wasDeduped: boolean }> {
  const {
    repoFullName, filePath, blobSHA, branch,
    agentId, findings, nodeIds, confidence
  } = params;

  const key = { repoFullName, filePath, branch, agentId };

  // Check existence first to set wasDeduped correctly
  const existing = await withDbTimeout(
    prisma.fileIntelligence.findUnique({
      where: { repoFullName_filePath_branch_agentId: key }
    }),
    DB_TIMEOUT_MS
  );

  // Prisma expects InputJsonValue for Json fields — cast via unknown
  const findingsJson = findings as unknown as Parameters<
    typeof prisma.fileIntelligence.upsert
  >[0]["create"]["findings"];

  const record = await withRetry(
    () => withDbTimeout(
      prisma.fileIntelligence.upsert({
        where:  { repoFullName_filePath_branch_agentId: key },
        create: {
          repoFullName, filePath, blobSHA, branch,
          agentId, findings: findingsJson, nodeIds, confidence,
        },
        update: {
          blobSHA,
          findings:  findingsJson,
          nodeIds,
          confidence,
          updatedAt: new Date(),
          version:   existing ? { increment: 1 } : 1,
        },
      }),
      DB_TIMEOUT_MS
    ),
    { label: `intelligence_store.upsert:${agentId}`, maxAttempts: 3 }
  );

  return {
    record:     { ...record, findings: toFindings(record.findings) },
    wasDeduped: !!existing,
  };
}

/**
 * Load all FileIntelligence records for a given repo+branch.
 * Used by the staleness checker and architecture route to attach
 * intelligence to nodes.
 */
export async function loadRepoIntelligence(
  repoFullName: string,
  branch:       string
): Promise<StoredFileIntelligence[]> {
  const records = await withDbTimeout(
    prisma.fileIntelligence.findMany({
      where:   { repoFullName, branch },
      orderBy: { analyzedAt: "desc" }
    }),
    DB_TIMEOUT_MS
  );
  return records.map((r) => ({ ...r, findings: toFindings(r.findings) }));
}

/**
 * Mark a set of file intelligence records as stale by setting blobSHA
 * to a sentinel value. The next getFreshIntelligence() call will return null.
 * Used by the staleness checker when changed files are detected.
 */
export async function markFilesStale(
  repoFullName: string,
  branch:       string,
  filePaths:    string[]
): Promise<void> {
  if (filePaths.length === 0) return;
  await withRetry(
    () => withDbTimeout(
      prisma.fileIntelligence.updateMany({
        where: { repoFullName, branch, filePath: { in: filePaths } },
        data:  { blobSHA: "__stale__", updatedAt: new Date() }
      }),
      DB_TIMEOUT_MS
    ),
    { label: "intelligence_store.mark_stale" }
  );
}

// ─── Repository Snapshot ──────────────────────────────────────

export interface StoredSnapshot {
  id:           string;
  repoFullName: string;
  branch:       string;
  snapshotAt:   Date;
  fileEntries:  SnapshotEntry[];
}

/**
 * Load the stored snapshot for a repo+branch.
 * Returns null if no snapshot exists yet.
 */
export async function loadSnapshot(
  repoFullName: string,
  branch:       string
): Promise<StoredSnapshot | null> {
  const record = await withDbTimeout(
    prisma.repositorySnapshot.findUnique({
      where: { repoFullName_branch: { repoFullName, branch } }
    }),
    DB_TIMEOUT_MS
  );
  if (!record) return null;
  return {
    ...record,
    fileEntries: toSnapshotEntries(record.fileEntries),
  };
}

/**
 * Upsert the repository snapshot with the current tree.
 * Caps entries at MAX_SNAPSHOT_ENTRIES to protect against huge monorepos.
 */
export async function upsertSnapshot(
  repoFullName: string,
  branch:       string,
  entries:      SnapshotEntry[]
): Promise<void> {
  const capped = entries.length > MAX_SNAPSHOT_ENTRIES
    ? entries.slice(0, MAX_SNAPSHOT_ENTRIES)
    : entries;

  if (entries.length > MAX_SNAPSHOT_ENTRIES) {
    console.warn(
      `[intelligence-store] snapshot capped at ${MAX_SNAPSHOT_ENTRIES}` +
      ` (repo had ${entries.length} files) repo=${repoFullName}`
    );
  }

  // Cast via unknown for Prisma's InputJsonValue
  const entriesJson = capped as unknown as Parameters<
    typeof prisma.repositorySnapshot.upsert
  >[0]["create"]["fileEntries"];

  await withRetry(
    () => withDbTimeout(
      prisma.repositorySnapshot.upsert({
        where:  { repoFullName_branch: { repoFullName, branch } },
        create: { repoFullName, branch, fileEntries: entriesJson },
        update: { fileEntries: entriesJson, snapshotAt: new Date() }
      }),
      DB_TIMEOUT_MS
    ),
    { label: "intelligence_store.upsert_snapshot" }
  );
}
