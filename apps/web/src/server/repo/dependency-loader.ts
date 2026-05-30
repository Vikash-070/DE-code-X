/**
 * Repository dependency loader — the I/O half of Increment B.
 *
 * Reads the shallowest package.json files (root first; ≤3 to cover common
 * monorepos) and merges their declared dependency names. Pairs with the PURE
 * `parsePackageDependencies` / `buildArchitectureGraph` in architecture-wire.ts.
 *
 * Fail-open: any error yields [] so Atlas's structural analysis is never blocked.
 * Shared by the Atlas analyzer and GET /api/repo/architecture so the graph is
 * built from exactly one dependency source.
 */

import { fetchFileContent } from "@/services/github/file";
import type { GitHubTreeNode } from "@/services/github/tree";
import { parsePackageDependencies } from "@/server/repo/architecture-wire";

/** Max package.json files to read — keeps the cost bounded (Increment B = cheap). */
const MAX_PACKAGE_JSON = 3;

export async function loadRepoDependencies(
  owner: string,
  repo: string,
  branch: string,
  githubToken: string,
  nodes: readonly GitHubTreeNode[]
): Promise<string[]> {
  void branch; // fetchFileContent resolves the default ref; branch kept for parity.

  const candidates = nodes
    .filter((n) => n.path === "package.json" || n.path.endsWith("/package.json"))
    .map((n) => n.path)
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, MAX_PACKAGE_JSON);

  if (candidates.length === 0) return [];

  const merged = new Set<string>();
  const results = await Promise.allSettled(
    candidates.map((p) => fetchFileContent(owner, repo, p, githubToken))
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const dep of parsePackageDependencies(r.value.content)) merged.add(dep);
    }
  }
  return [...merged];
}
