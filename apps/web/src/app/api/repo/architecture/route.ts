/**
 * GET /api/repo/architecture?owner=x&repo=y&branch=z
 *
 * Returns the Architecture Workspace tree for a GitHub repository.
 *
 * Pipeline:
 *   1. Auth (Clerk) — reject unauthenticated requests
 *   2. GitHub token — retrieved server-side, NEVER sent to client
 *   3. Parallel fetch:
 *      a. fetchRepoTree()       — file tree (10-min in-process cache)
 *      b. getOrBuildSystemMap() — package.json analysis (60-min in-process cache)
 *   4. enrichSystemMapWithTree() — upgrade partial→strong evidence (pure, ~2-5ms)
 *   5. buildDomainMap()          — directory prefix analysis (pure, ~1ms)
 *   6. serializeArchitectureTree() — produces ArchitectureTreeNode[]
 *   7. JSON response
 *
 * Both the tree and system map are optional. The endpoint returns partial data
 * when either fetch fails — the frontend handles "partial" state gracefully.
 *
 * Error responses:
 *   401 — not authenticated
 *   401 — GitHub not connected
 *   422 — missing owner/repo params
 *   404 — repository not found
 *   403 — no access
 *   200 — always when data exists (even partial)
 *
 * SECURITY: GitHub token retrieved server-side via Clerk OAuth.
 * Never included in response body. Never logged.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { fetchRepoTree }              from "@/services/github/tree";
import { getOrBuildSystemMap }        from "@/server/repo/system-registry";
import { enrichSystemMapWithTree }    from "@/server/repo/system-registry";
import { buildDomainMap }             from "@/server/repo/domain-map";
import { serializeArchitectureTree }  from "@/server/repo/architecture-serializer";
import { checkStaleness, buildNodeFreshnessMap } from "@/server/repo/staleness-checker";
import { buildArchitectureGraph }     from "@/server/repo/architecture-wire";
import { buildFileMap }               from "@/server/repo/file-map";
import { loadRepoDependencies }       from "@/server/repo/dependency-loader";
import type { ArchitectureResponse, ArchitectureTreeNode }  from "@/types/architecture";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── 2. Query params ────────────────────────────────────────
  const url    = new URL(request.url);
  const owner  = url.searchParams.get("owner")?.trim();
  const repo   = url.searchParams.get("repo")?.trim();
  const branch = url.searchParams.get("branch")?.trim() ?? "main";

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "owner and repo query params are required" },
      { status: 422 }
    );
  }

  const repoFullName = `${owner}/${repo}`;
  const t0 = Date.now();

  // ── 3. GitHub token ────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    return NextResponse.json(
      { error: "Failed to retrieve GitHub token. Ensure GitHub is connected in your account." },
      { status: 502 }
    );
  }

  if (!githubToken) {
    return NextResponse.json(
      { error: "GitHub not connected. Connect your GitHub account to enable repository intelligence." },
      { status: 401 }
    );
  }

  // ── 4. Parallel fetch: tree + system map ──────────────────
  // Both are best-effort. Failures produce null, not 500s.
  const treePromise = fetchRepoTree(owner, repo, branch, githubToken).catch(err => {
    const msg = err instanceof Error ? err.message : String(err);

    // Surface GitHub 404/401 — these are user-actionable errors
    if (msg.includes("404")) {
      throw Object.assign(
        new Error(`Repository ${repoFullName} not found or you don't have access.`),
        { status: 404 }
      );
    }
    if (msg.includes("401") || msg.includes("403")) {
      throw Object.assign(
        new Error("GitHub token does not have access to this repository."),
        { status: 403 }
      );
    }

    console.log(`[architecture] tree_fetch_failed repo=${repoFullName} reason=${msg.slice(0, 80)}`);
    return null;
  });

  const systemMapPromise = getOrBuildSystemMap(repoFullName, userId, null).catch(() => null);

  let tree: Awaited<typeof treePromise>;
  let rawSystemMap: Awaited<typeof systemMapPromise>;

  try {
    [tree, rawSystemMap] = await Promise.all([treePromise, systemMapPromise]);
  } catch (err) {
    // Re-throw surfaced GitHub errors with their status
    const statusErr = err as { message: string; status?: number };
    return NextResponse.json(
      { error: statusErr.message },
      { status: statusErr.status ?? 500 }
    );
  }

  // ── 5. Enrich + domain map (pure — zero API calls) ─────────
  const enrichedSystemMap = (rawSystemMap && tree)
    ? enrichSystemMapWithTree(rawSystemMap, tree)
    : rawSystemMap;

  const domainMap = tree ? buildDomainMap(tree) : null;

  // ── 6. Staleness check (non-fatal — runs in parallel with serialize) ──
  // Compares current tree blob SHAs against stored RepositorySnapshot.
  // Updates the snapshot and marks stale FileIntelligence records.
  let stalenessResult = null;
  let freshnessMap: Awaited<ReturnType<typeof buildNodeFreshnessMap>> | null = null;

  if (tree) {
    try {
      stalenessResult = await checkStaleness(tree, branch);
      freshnessMap    = await buildNodeFreshnessMap(repoFullName, branch, stalenessResult);
    } catch (err) {
      // Staleness check failure must never break the workspace
      console.warn(`[architecture] staleness_check_failed repo=${repoFullName}`, err);
    }
  }

  // ── 6b. Architecture graph (Atlas Relationship Engine, Increment A+B) ──
  // Deterministic system nodes + external-dependency edges. Built from the same
  // tree; the dependency read is bounded (≤3 package.json) and fail-open.
  let architectureGraph: ArchitectureResponse["architectureGraph"];
  let fileMap: ArchitectureResponse["fileMap"];
  if (tree) {
    const fullNodes    = tree.rawNodes ?? tree.nodes;
    const dependencies = await loadRepoDependencies(owner, repo, branch, githubToken, fullNodes)
      .catch(() => [] as string[]);
    architectureGraph  = buildArchitectureGraph({
      nodes:        fullNodes,
      dependencies,
      truncated:    tree.truncated ?? false,
    });
    fileMap = buildFileMap(fullNodes);
  }

  // ── 7. Serialize ───────────────────────────────────────────
  const treeNodes = serializeArchitectureTree(domainMap, enrichedSystemMap);

  // Attach freshness metadata to nodes that have stored intelligence
  const enrichedNodes = freshnessMap && freshnessMap.size > 0
    ? attachFreshnessToNodes(treeNodes, freshnessMap)
    : treeNodes;

  // Determine source labels for metadata
  const hasStrong   = enrichedSystemMap?.systems.some(s => s.status === "strong") ?? false;
  const systemSource: ArchitectureResponse["systemSource"] = hasStrong
    ? "package-json+source-evidence"
    : "package-json";

  const response: ArchitectureResponse = {
    tree:         enrichedNodes,
    domainSource: "tree-scan",
    systemSource,
    repoFullName,
    generatedAt:  new Date().toISOString(),
    architectureGraph,
    fileMap,
  };

  console.log(
    `[architecture] served` +
    ` repo=${repoFullName}` +
    ` sections=${enrichedNodes.length}` +
    ` domains=${domainMap?.domains.length ?? 0}` +
    ` systems=${enrichedSystemMap?.systems.length ?? 0}` +
    ` strong=${enrichedSystemMap?.systems.filter(s => s.status === "strong").length ?? 0}` +
    ` stale_nodes=${stalenessResult?.staleNodeIds.length ?? 0}` +
    ` changed_files=${stalenessResult?.changedFiles.length ?? 0}` +
    ` duration=${Date.now() - t0}ms`
  );

  return NextResponse.json(response);
}

// ─── Freshness attachment ─────────────────────────────────────

/**
 * Walk the node tree and attach freshnessStatus, staleFileCount, and
 * lastIntelligenceAt from the freshnessMap to matching nodes.
 *
 * Mutates a shallow copy — does not modify the original serialized nodes.
 */
function attachFreshnessToNodes(
  nodes: ArchitectureTreeNode[],
  freshnessMap: Map<string, { status: "fresh" | "stale"; staleFileCount: number; lastIntelligenceAt: string }>
): ArchitectureTreeNode[] {
  return nodes.map(node => {
    const freshness = freshnessMap.get(node.id);
    const enriched: ArchitectureTreeNode = freshness
      ? {
          ...node,
          freshnessStatus:    freshness.status,
          staleFileCount:     freshness.staleFileCount,
          lastIntelligenceAt: freshness.lastIntelligenceAt,
        }
      : node;

    if (enriched.children && enriched.children.length > 0) {
      return { ...enriched, children: attachFreshnessToNodes(enriched.children, freshnessMap) };
    }

    return enriched;
  });
}
