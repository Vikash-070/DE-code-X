/**
 * POST /api/repo/analyze-file
 *
 * Triggers Cipher analysis on a single repository file.
 * Persists findings to the FileIntelligence table.
 * Returns AgentResult.
 *
 * Error responses:
 *   401 — not authenticated or GitHub not connected
 *   422 — missing / invalid body params
 *   404 — file not found in repo tree
 *   402 — OpenRouter credits exhausted
 *   503 — no AI provider key configured
 *   500 — analysis or persist failure
 *
 * SECURITY: githubToken and AI apiKey never appear in response body.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { getOrProvisionUser } from "@/lib/get-or-provision-user";
import { prisma }             from "@/lib/prisma";
import { decryptKey }         from "@/server/ai/encryption";
import { analyzeFileWithCipher } from "@/server/repo/cipher-analyzer";
import type { AgentResult }   from "@/types/intelligence";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  // ── 2. Parse body ──────────────────────────────────────────
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 422 }); }

  const { owner, repo, filePath, branch = "main" } = (body ?? {}) as Record<string, unknown>;
  if (typeof owner    !== "string" || !owner.trim())    return NextResponse.json({ error: "owner is required"    }, { status: 422 });
  if (typeof repo     !== "string" || !repo.trim())     return NextResponse.json({ error: "repo is required"     }, { status: 422 });
  if (typeof filePath !== "string" || !filePath.trim()) return NextResponse.json({ error: "filePath is required" }, { status: 422 });
  if (typeof branch   !== "string")                     return NextResponse.json({ error: "branch must be a string" }, { status: 422 });

  // ── 3. GitHub token ────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    return NextResponse.json({ error: "Failed to retrieve GitHub token." }, { status: 502 });
  }
  if (!githubToken) {
    return NextResponse.json({ error: "GitHub not connected. Connect your account in Settings." }, { status: 401 });
  }

  // ── 4. Resolve/provision DB user ──────────────────────────
  // getOrProvisionUser creates the row on first request so we never 401
  // just because the DB was just initialised (prisma db push just ran).
  const dbUser = await getOrProvisionUser(userId);
  if (!dbUser) {
    return NextResponse.json({ error: "Could not resolve user account. Check your database connection." }, { status: 503 });
  }

  // ── 5. AI provider key ────────────────────────────────────
  const providerKey = await prisma.userProviderKey.findFirst({
    where:   { userId: dbUser.id, isActive: true },
    orderBy: { lastUsedAt: "desc" },
  });
  if (!providerKey) {
    return NextResponse.json(
      { error: "No AI key configured. Add your OpenRouter key in Settings → AI Providers." },
      { status: 503 }
    );
  }

  let apiKey: string;
  try { apiKey = decryptKey(providerKey.encryptedKey); }
  catch {
    return NextResponse.json({ error: "Failed to decrypt AI key. Re-save it in Settings → AI Providers." }, { status: 500 });
  }

  // ── 6. Run Cipher ─────────────────────────────────────────
  let result: AgentResult;
  try {
    result = await analyzeFileWithCipher({
      owner:       owner.trim(),
      repo:        repo.trim(),
      filePath:    filePath.trim(),
      branch:      branch.trim(),
      githubToken,
      aiConfig: {
        provider: providerKey.provider as "anthropic" | "openai" | "openrouter" | "gemini",
        apiKey,
        model:    providerKey.model ?? undefined,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[analyze-file] cipher_failed file=${filePath} cause=${msg}`);

    // Surface specific, actionable errors for every known failure mode.
    if (msg.includes("not found in tree") || msg.includes("404")) {
      return NextResponse.json({ error: `File not found in repo: ${filePath.trim()}` }, { status: 404 });
    }
    if (msg.includes("402") || msg.toLowerCase().includes("credits") || msg.toLowerCase().includes("afford")) {
      return NextResponse.json(
        { error: "OpenRouter credits exhausted. Add credits at openrouter.ai/settings/credits." },
        { status: 402 }
      );
    }
    if (msg.includes("401") || msg.includes("authentication failed") || msg.toLowerCase().includes("invalid api key")) {
      return NextResponse.json(
        { error: "OpenRouter rejected the API key. Re-save it in Settings → AI Providers." },
        { status: 401 }
      );
    }
    if (msg.includes("429")) {
      return NextResponse.json({ error: "OpenRouter rate limit hit. Wait a moment and try again." }, { status: 429 });
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED")) {
      return NextResponse.json({ error: "AI provider timed out. Try again in a moment." }, { status: 504 });
    }

    // Always surface the real cause — no more "check that the file exists" in prod.
    return NextResponse.json({ error: `Analysis failed: ${msg.slice(0, 200)}` }, { status: 500 });
  }

  // Fire-and-forget lastUsedAt update.
  prisma.userProviderKey
    .update({ where: { id: providerKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return NextResponse.json(result);
}
