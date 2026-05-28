/**
 * Repository Staleness Checker.
 *
 * Compares the current GitHub tree (blob SHAs) against the last stored
 * RepositorySnapshot to detect which files changed since the last analysis.
 *
 * Design principles:
 *   - No GitHub API calls — uses the already-fetched tree from fetchRepoTree().
 *   - No polling — staleness is computed lazily when the architecture workspace opens.
 *   - Deterministic — blobSHA comparison, no AI involved.
 *   - O(n) — single Map pass over the snapshot, single pass over current tree.
 *
 * Output:
 *   StalenessResult with changedFiles, removedFiles, newFiles, and staleNodeIds.
 *   staleNodeIds are the architecture node IDs (from FileIntelligence.nodeIds)
 *   that have at least one stale associated file — used by the architecture
 *   route to attach freshnessStatus to ArchitectureTreeNodes.
 */

import type { RepoTree } from "@/services/github/tree";
import type { StalenessResult, SnapshotEntry } from "@/types/intelligence";
import {
  loadSnapshot,
  upsertSnapshot,
  loadRepoIntelligence,
  markFilesStale,
} from "./intelligence-store";

// ─── Public API ───────────────────────────────────────────────

/**
 * Run a staleness check against the current tree.
 *
 * Side-effects:
 *   1. Upserts the RepositorySnapshot with the current tree (always).
 *   2. Marks changed FileIntelligence records as stale.
 *
 * Returns StalenessResult. Callers should treat any error as non-fatal
 * (staleness check failure should not break the architecture workspace).
 */
export async function checkStaleness(
  tree: RepoTree,
  branch: string
): Promise<StalenessResult> {
  const { owner, repo } = tree;
  const repoFullName = `${owner}/${repo}`;

  // Build current blob-only entries (skip directory nodes)
  type TreeNode = { path: string; type: string; sha: string };
  const currentEntries: SnapshotEntry[] = tree.nodes
    .filter((n: TreeNode) => n.type === "blob")
    .map((n: TreeNode) => ({ path: n.path, blobSHA: n.sha }));

  // Load prior snapshot
  const prior = await loadSnapshot(repoFullName, branch);

  let changedFiles: SnapshotEntry[] = [];
  let removedFiles: string[]        = [];
  let newFiles: SnapshotEntry[]     = [];

  if (prior) {
    // Build lookup map: path → blobSHA
    const priorMap = new Map<string, string>(
      prior.fileEntries.map(e => [e.path, e.blobSHA])
    );
    const currentMap = new Map<string, string>(
      currentEntries.map(e => [e.path, e.blobSHA])
    );

    // Changed: path exists in both but SHA differs
    for (const entry of currentEntries) {
      const priorSHA = priorMap.get(entry.path);
      if (priorSHA === undefined) {
        newFiles.push(entry); // new file
      } else if (priorSHA !== entry.blobSHA) {
        changedFiles.push(entry); // changed
      }
    }

    // Removed: path in prior but not in current
    for (const path of priorMap.keys()) {
      if (!currentMap.has(path)) {
        removedFiles.push(path);
      }
    }
  }

  // Always upsert snapshot with current tree (fire-and-forget errors)
  upsertSnapshot(repoFullName, branch, currentEntries).catch(err => {
    console.error(`[staleness] snapshot_upsert_failed repo=${repoFullName}`, err);
  });

  // Mark changed files as stale in intelligence store
  const allChangedPaths = [
    ...changedFiles.map(f => f.path),
    ...removedFiles,
  ];

  if (allChangedPaths.length > 0) {
    markFilesStale(repoFullName, branch, allChangedPaths).catch(err => {
      console.error(`[staleness] mark_stale_failed repo=${repoFullName}`, err);
    });
  }

  // Determine which architecture node IDs are stale
  const staleNodeIds = await computeStaleNodeIds(
    repoFullName,
    branch,
    allChangedPaths
  );

  return {
    repoFullName,
    branch,
    changedFiles,
    removedFiles,
    newFiles,
    hadPriorSnapshot: !!prior,
    staleNodeIds,
  };
}

/**
 * Attach freshnessStatus to a map of nodeId → status.
 * Used by the architecture route to enrich ArchitectureTreeNodes.
 *
 * Returns a Map<nodeId, { status, staleFileCount, lastIntelligenceAt }>.
 */
export async function buildNodeFreshnessMap(
  repoFullName: string,
  branch:       string,
  stalenessResult: StalenessResult | null
): Promise<Map<string, NodeFreshness>> {
  const freshnessMap = new Map<string, NodeFreshness>();

  // Load all intelligence records for this repo
  const records = await loadRepoIntelligence(repoFullName, branch);
  if (records.length === 0) return freshnessMap;

  const staleNodeSet = new Set(stalenessResult?.staleNodeIds ?? []);
  const staleFileSet = new Set([
    ...(stalenessResult?.changedFiles.map((f: SnapshotEntry) => f.path) ?? []),
    ...(stalenessResult?.removedFiles ?? []),
  ]);

  // For each record, contribute to its nodeIds
  for (const record of records) {
    const isStale = staleFileSet.has(record.filePath) || record.blobSHA === "__stale__";

    for (const nodeId of record.nodeIds) {
      const existing = freshnessMap.get(nodeId);
      const staleCount = isStale ? 1 : 0;

      if (!existing) {
        freshnessMap.set(nodeId, {
          status: isStale ? "stale" : (staleNodeSet.has(nodeId) ? "stale" : "fresh"),
          staleFileCount: staleCount,
          lastIntelligenceAt: record.analyzedAt.toISOString(),
        });
      } else {
        freshnessMap.set(nodeId, {
          status: (isStale || existing.status === "stale") ? "stale" : "fresh",
          staleFileCount: existing.staleFileCount + staleCount,
          // Keep the most recent timestamp
          lastIntelligenceAt:
            record.analyzedAt > new Date(existing.lastIntelligenceAt)
              ? record.analyzedAt.toISOString()
              : existing.lastIntelligenceAt,
        });
      }
    }
  }

  return freshnessMap;
}

export interface NodeFreshness {
  status: "fresh" | "stale";
  staleFileCount: number;
  lastIntelligenceAt: string;
}

// ─── Internal ─────────────────────────────────────────────────

async function computeStaleNodeIds(
  repoFullName: string,
  branch:       string,
  changedPaths: string[]
): Promise<string[]> {
  if (changedPaths.length === 0) return [];

  const records = await loadRepoIntelligence(repoFullName, branch);
  const changedSet = new Set(changedPaths);
  const staleNodeIds = new Set<string>();

  for (const record of records) {
    if (changedSet.has(record.filePath)) {
      for (const nodeId of record.nodeIds) {
        staleNodeIds.add(nodeId);
      }
    }
  }

  return Array.from(staleNodeIds);
}
