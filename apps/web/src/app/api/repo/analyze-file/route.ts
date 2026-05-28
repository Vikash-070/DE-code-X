/**
 * POST /api/repo/analyze-file
 *
 * Triggers Cipher analysis on a single repository file.
 * Persists findings to the FileIntelligence table.
 * Returns AgentResult.
 *
 * Request body (JSON):
 *   { owner, repo, filePath, branch? }
 *
 * Pipeline:
 *   1. Auth (Clerk)
 *   2. GitHub token — server-side only
 *   3. Resolve user's active AI provider key
 *   4. analyzeFileWithCipher() — fetch file, call AI, persist, return findings
 *
 * Error responses:
 *   401 — not authenticated
 *   401 — GitHub not connected
 *   422 — missing / invalid body params
 *   404 — file not found in repo tree
 *   503 — no AI provider key configured
 *   500 — analysis or persist failure
 *
 * SECURITY: githubToken and AI apiKey never appear in response body.
 * Findings are grounded in file content only — Cipher's prompt forbids invention.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { prisma }                  from "@/lib/prisma";
import { decryptKey }              from "@/server/ai/encryption";
import { analyzeFileWithCipher }   from "@/server/repo/cipher-analyzer";
import type { AgentResult }        from "@/types/intelligence";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── 2. Parse body ──────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 422 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body required" }, { status: 422 });
  }

  const { owner, repo, filePath, branch = "main" } = body as Record<string, unknown>;

  if (typeof owner !== "string" || !owner.trim()) {
    return NextResponse.json({ error: "owner is required" }, { status: 422 });
  }
  if (typeof repo !== "string" || !repo.trim()) {
    return NextResponse.json({ error: "repo is required" }, { status: 422 });
  }
  if (typeof filePath !== "string" || !filePath.trim()) {
    return NextResponse.json({ error: "filePath is required" }, { status: 422 });
  }
  if (typeof branch !== "string") {
    return NextResponse.json({ error: "branch must be a string" }, { status: 422 });
  }

  // ── 3. GitHub token ────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    return NextResponse.json(
      { error: "Failed to retrieve GitHub token." },
      { status: 502 }
    );
  }

  if (!githubToken) {
    return NextResponse.json(
      { error: "GitHub not connected. Connect your GitHub account to enable file analysis." },
      { status: 401 }
    );
  }

  // ── 4. Resolve AI provider key ─────────────────────────────
  // Find the user's DB record
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true }
  });

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const providerKey = await prisma.userProviderKey.findFirst({
    where: { userId: dbUser.id, isActive: true },
    orderBy: { lastUsedAt: "desc" }
  });

  if (!providerKey) {
    return NextResponse.json(
      { error: "No AI provider configured. Add an API key in Settings → AI Providers." },
      { status: 503 }
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptKey(providerKey.encryptedKey);
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt AI provider key. Re-save your key in Settings." },
      { status: 500 }
    );
  }

  // ── 5. Run Cipher ──────────────────────────────────────────
  let result: AgentResult;
  try {
    result = await analyzeFileWithCipher({
      owner:       owner.trim(),
      repo:        repo.trim(),
      filePath:    filePath.trim(),
      branch:      branch.trim(),
      githubToken,
      aiConfig: {
        provider: providerKey.provider as "anthropic" | "openai" | "openrouter",
        apiKey,
        model:    providerKey.model ?? undefined,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("not found in tree")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }

    // Log the actual cause for debugging — visible in Next.js server logs
    console.error(`[analyze-file] cipher_failed file=${filePath} cause=${msg}`, err);

    // Surface the underlying message in development
    const detail =
      process.env.NODE_ENV === "development"
        ? `Analysis failed: ${msg}`
        : "Analysis failed. Check that the file exists and your AI provider is reachable.";

    return NextResponse.json({ error: detail }, { status: 500 });
  }

  // Update lastUsedAt on the provider key (fire-and-forget)
  prisma.userProviderKey
    .update({ where: { id: providerKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return NextResponse.json(result);
}
