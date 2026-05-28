/**
 * POST /api/repo/tree
 *
 * Returns the flat file-path list for a GitHub repository.
 * Cached in-process for 10 minutes — safe to call on every workspace open.
 *
 * Body: { owner: string; repo: string; branch?: string }
 * Response: { tree: GitHubTreeNode[]; branch: string; fetchedAt: number; cached: boolean }
 *
 * SECURITY: GitHub token retrieved server-side via Clerk OAuth — never sent to client.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { fetchRepoTree }      from "@/services/github/tree";
import type { GitHubTreeNode } from "@/services/github/tree";

export const dynamic = "force-dynamic";

interface TreeRequest {
  owner:   string;
  repo:    string;
  branch?: string;
}

interface TreeResponse {
  tree:      GitHubTreeNode[];
  branch:    string;
  fetchedAt: number;
  cached:    boolean;
}

export async function POST(request: Request): Promise<Response> {
  // ── Auth ───────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────
  let body: TreeRequest;
  try {
    body = (await request.json()) as TreeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { owner, repo, branch = "main" } = body;

  if (!owner?.trim() || !repo?.trim()) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 422 });
  }

  // ── GitHub token ───────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch (err) {
    console.error("[repo/tree] clerk_token_error", err);
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

  // ── Fetch tree ─────────────────────────────────────────────
  try {
    const before = Date.now();
    const tree   = await fetchRepoTree(owner.trim(), repo.trim(), branch.trim(), githubToken);
    const fromCache = Date.now() - before < 50; // <50ms → was a cache hit

    const response: TreeResponse = {
      tree:      tree.nodes,
      branch:    tree.branch,
      fetchedAt: tree.fetchedAt,
      cached:    fromCache
    };

    console.log(
      `[repo/tree] served owner=${owner} repo=${repo} branch=${branch}` +
      ` nodes=${tree.nodes.length} cached=${fromCache}`
    );

    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[repo/tree] fetch_error owner=${owner} repo=${repo}`, msg);

    // Surface GitHub 404 / 401 specifically
    if (msg.includes("404")) {
      return NextResponse.json(
        { error: `Repository ${owner}/${repo} not found or you don't have access.` },
        { status: 404 }
      );
    }
    if (msg.includes("401") || msg.includes("403")) {
      return NextResponse.json(
        { error: "GitHub token does not have access to this repository." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
