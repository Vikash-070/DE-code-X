/**
 * POST /api/repo/file
 *
 * On-demand file content retrieval from a GitHub repository.
 * Content is decoded, filtered for binary, and truncated at MAX_CONTENT_CHARS.
 * Cached in-process for 5 minutes.
 *
 * Body: { owner: string; repo: string; path: string; ref?: string }
 * Response: { path: string; content: string; size: number; truncated: boolean }
 *
 * SECURITY: GitHub token retrieved server-side via Clerk OAuth — never sent to client.
 * Content is served to authenticated users only.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { fetchFileContent }    from "@/services/github/file";

export const dynamic = "force-dynamic";

interface FileRequest {
  owner: string;
  repo:  string;
  path:  string;
  ref?:  string;
}

export async function POST(request: Request): Promise<Response> {
  // ── Auth ───────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────
  let body: FileRequest;
  try {
    body = (await request.json()) as FileRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { owner, repo, path, ref } = body;

  if (!owner?.trim() || !repo?.trim() || !path?.trim()) {
    return NextResponse.json(
      { error: "owner, repo, and path are required" },
      { status: 422 }
    );
  }

  // Guard against path traversal
  const safePath = path.trim().replace(/\.\.\//g, "").replace(/^\//, "");
  if (!safePath) {
    return NextResponse.json({ error: "Invalid path" }, { status: 422 });
  }

  // ── GitHub token ───────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch (err) {
    console.error("[repo/file] clerk_token_error", err);
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

  // ── Fetch file ─────────────────────────────────────────────
  try {
    const file = await fetchFileContent(
      owner.trim(),
      repo.trim(),
      safePath,
      githubToken,
      ref?.trim()
    );

    console.log(
      `[repo/file] served path=${safePath} size=${file.size}b truncated=${file.truncated}`
    );

    return NextResponse.json({
      path:      file.path,
      content:   file.content,
      size:      file.size,
      truncated: file.truncated,
      sha:       file.sha
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[repo/file] error owner=${owner} repo=${repo} path=${safePath}`, msg);

    if (msg.includes("404")) {
      return NextResponse.json(
        { error: `File not found: ${safePath}` },
        { status: 404 }
      );
    }
    if (msg.includes("too large")) {
      return NextResponse.json(
        { error: msg },
        { status: 413 }
      );
    }
    if (msg.includes("binary")) {
      return NextResponse.json(
        { error: msg },
        { status: 415 }
      );
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
