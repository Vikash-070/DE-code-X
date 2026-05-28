/**
 * POST /api/repo/search
 *
 * Fuzzy filename search over a cached repository tree.
 * Fetches the tree if not yet cached; returns ranked file matches.
 *
 * Body: { owner: string; repo: string; query: string; branch?: string; limit?: number }
 * Response: { matches: GitHubTreeNode[]; query: string; total: number }
 *
 * SECURITY: GitHub token retrieved server-side via Clerk OAuth — never sent to client.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { fetchRepoTree, searchTree } from "@/services/github/tree";
import type { GitHubTreeNode }        from "@/services/github/tree";

export const dynamic = "force-dynamic";

interface SearchRequest {
  owner:   string;
  repo:    string;
  query:   string;
  branch?: string;
  limit?:  number;
}

interface SearchResponse {
  matches: GitHubTreeNode[];
  query:   string;
  total:   number;
}

export async function POST(request: Request): Promise<Response> {
  // ── Auth ───────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────
  let body: SearchRequest;
  try {
    body = (await request.json()) as SearchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { owner, repo, query, branch = "main", limit = 10 } = body;

  if (!owner?.trim() || !repo?.trim()) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 422 });
  }
  if (!query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 422 });
  }

  const safeLimit = Math.min(Math.max(1, limit), 20); // clamp 1–20

  // ── GitHub token ───────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch (err) {
    console.error("[repo/search] clerk_token_error", err);
    return NextResponse.json(
      { error: "Failed to retrieve GitHub token." },
      { status: 502 }
    );
  }

  if (!githubToken) {
    return NextResponse.json(
      { error: "GitHub not connected." },
      { status: 401 }
    );
  }

  // ── Fetch tree (cache hit expected after first /api/repo/tree call) ──
  try {
    const tree = await fetchRepoTree(
      owner.trim(),
      repo.trim(),
      branch.trim(),
      githubToken
    );

    const matches = searchTree(tree, query.trim(), safeLimit);

    console.log(
      `[repo/search] query="${query}" owner=${owner} repo=${repo}` +
      ` matches=${matches.length}`
    );

    const response: SearchResponse = {
      matches,
      query: query.trim(),
      total: matches.length
    };

    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[repo/search] error owner=${owner} repo=${repo} query=${query}`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
