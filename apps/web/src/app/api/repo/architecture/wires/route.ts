/**
 * GET /api/repo/architecture/wires?owner=x&repo=y&branch=z
 *
 * Stage 2 (Increment C) — the file→file "Calls / Sends To" wires.
 *
 * This is the only Atlas endpoint that READS file contents, so it is separate
 * from and lazier than the base architecture load. It reads a BOUNDED set of
 * high-signal anchor files (≤MAX_ANCHORS), parses their imports, and resolves
 * each to a real repo path (relative + tsconfig aliases) → deterministic edges
 * with file:line evidence. No AI.
 *
 * SECURITY: GitHub token retrieved server-side via Clerk OAuth; never returned.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { fetchRepoTree, buildPathIndex } from "@/services/github/tree";
import { fetchFileContent }              from "@/services/github/file";
import { buildFileMap }                  from "@/server/repo/file-map";
import {
  buildImportGraph,
  parseTsconfigAliases,
  type ImportGraph,
} from "@/server/repo/import-graph";
import { rateLimit } from "@/server/security/guards";

export const dynamic = "force-dynamic";

/** Hard cap on files read per wires scan — keeps GitHub cost bounded. */
const MAX_ANCHORS = 150;

export interface WiresResponse extends ImportGraph {
  repoFullName: string;
  generatedAt: string;
}

export async function GET(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  // Rate limit: each scan can read up to MAX_ANCHORS files from GitHub —
  // 10 per 5 minutes per user protects the shared GitHub rate budget.
  const rl = rateLimit(`wires:${userId}`, 10, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many scans. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const url    = new URL(request.url);
  const owner  = url.searchParams.get("owner")?.trim();
  const repo   = url.searchParams.get("repo")?.trim();
  const branch = url.searchParams.get("branch")?.trim() ?? "main";
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo query params are required" }, { status: 422 });
  }
  const repoFullName = `${owner}/${repo}`;
  const t0 = Date.now();

  // GitHub token (server-side only).
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    return NextResponse.json({ error: "Failed to retrieve GitHub token." }, { status: 502 });
  }
  if (!githubToken) {
    return NextResponse.json({ error: "GitHub not connected." }, { status: 401 });
  }

  // Tree (cached) → file map + path index.
  let tree;
  try {
    tree = await fetchRepoTree(owner, repo, branch, githubToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("404") ? 404 : msg.includes("401") || msg.includes("403") ? 403 : 500;
    return NextResponse.json({ error: `Could not read ${repoFullName}.` }, { status });
  }

  const fullNodes = tree.rawNodes ?? tree.nodes;
  const fileMap   = buildFileMap(fullNodes);
  const pathIndex = buildPathIndex(tree);

  // tsconfig aliases — read the shallowest tsconfig*.json if present (best-effort).
  const tsconfigPath = fullNodes
    .filter((n) => n.type !== "tree" && /(^|\/)tsconfig(\.[\w.-]+)?\.json$/.test(n.path))
    .map((n) => n.path)
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];

  let aliases = [] as ReturnType<typeof parseTsconfigAliases>;
  if (tsconfigPath) {
    try {
      const tsconfig = await fetchFileContent(owner, repo, tsconfigPath, githubToken);
      aliases = parseTsconfigAliases(tsconfig.content);
    } catch {
      // best-effort
    }
  }

  // Build the import graph with a fail-open content fetcher.
  const graph = await buildImportGraph({
    files: fileMap.files,
    pathIndex,
    aliases,
    maxAnchors: MAX_ANCHORS,
    fetchContent: async (path) => {
      try {
        const f = await fetchFileContent(owner, repo, path, githubToken!);
        return f.content;
      } catch {
        return null;
      }
    },
  });

  console.log(
    `[wires] served repo=${repoFullName}` +
    ` edges=${graph.edges.length} scanned=${graph.scanned}` +
    ` anchors=${graph.anchors} truncated=${graph.truncated}` +
    ` duration=${Date.now() - t0}ms`
  );

  const response: WiresResponse = {
    ...graph,
    repoFullName,
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(response);
}
