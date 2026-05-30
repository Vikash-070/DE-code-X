/**
 * POST /api/repo/architecture/narrate
 * Body: { owner, repo, branch?, path }
 *
 * Stage 3 — AI narration for a SINGLE file (Technical Role / Plain English /
 * Notes). This makes one paid OpenRouter call against the user's key, so it
 * runs ONLY on an explicit request from the canvas (confirm-before-spend).
 * Results are cached in-process by content hash → re-opening a file is free.
 *
 * SECURITY: key decrypted server-side only; never returned. GitHub token
 * retrieved server-side via Clerk OAuth.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { prisma }             from "@/lib/prisma";
import { decryptKey }         from "@/server/ai/encryption";
import { OPENROUTER_KEY_PREFIX } from "@/server/ai/constants";
import { fetchFileContent }   from "@/services/github/file";
import { classifyFile }       from "@/server/repo/file-map";
import { narrateFile, type FileNarration } from "@/server/repo/narration";

export const dynamic = "force-dynamic";

// In-process cache: `${repo}:${path}:${contentHash}` → narration.
const narrationCache = new Map<string, FileNarration>();

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface NarrateRequest {
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: NarrateRequest;
  try {
    body = (await request.json()) as NarrateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const owner = body.owner?.trim();
  const repo  = body.repo?.trim();
  const path  = body.path?.trim();
  if (!owner || !repo || !path) {
    return NextResponse.json({ error: "owner, repo and path are required" }, { status: 422 });
  }
  const repoFullName = `${owner}/${repo}`;

  // ── OpenRouter key (paid call) ──────────────────────────────
  const keyRecord = await prisma.userProviderKey.findFirst({
    where: { user: { clerkId: userId }, provider: "openrouter", isActive: true },
    select: { encryptedKey: true, model: true },
  }).catch(() => null);

  if (!keyRecord) {
    return NextResponse.json(
      { error: "No OpenRouter key configured. Add one in Settings → AI Providers." },
      { status: 503 }
    );
  }
  let apiKey: string;
  try {
    apiKey = decryptKey(keyRecord.encryptedKey);
  } catch {
    return NextResponse.json({ error: "Your OpenRouter key couldn't be decrypted. Re-save it in Settings." }, { status: 503 });
  }
  if (!apiKey.startsWith(OPENROUTER_KEY_PREFIX)) {
    return NextResponse.json({ error: "Your OpenRouter key format looks invalid (expected sk-or-…)." }, { status: 503 });
  }

  // ── GitHub token ────────────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    return NextResponse.json({ error: "Failed to retrieve GitHub token." }, { status: 502 });
  }
  if (!githubToken) return NextResponse.json({ error: "GitHub not connected." }, { status: 401 });

  // ── Fetch the file (single read) ────────────────────────────
  let content: string;
  try {
    const file = await fetchFileContent(owner, repo, path, githubToken);
    content = file.content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("404") ? 404 : 502;
    return NextResponse.json({ error: `Couldn't read \`${path}\`.` }, { status });
  }

  // ── Cache check (by content hash) ───────────────────────────
  const cacheKey = `${repoFullName}:${path}:${fnv1a(content)}`;
  const cached = narrationCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ narration: cached, fromCache: true });
  }

  // ── Narrate (paid) ──────────────────────────────────────────
  const { role, layer } = classifyFile(path);
  let narration: FileNarration;
  try {
    narration = await narrateFile({ path, role, layer, content, apiKey, model: keyRecord.model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Narration failed.";
    console.log(`[narrate] failed repo=${repoFullName} path=${path} err=${msg.slice(0, 100)}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  narrationCache.set(cacheKey, narration);
  console.log(`[narrate] served repo=${repoFullName} path=${path} notes=${narration.notes.length}`);
  return NextResponse.json({ narration, fromCache: false });
}
