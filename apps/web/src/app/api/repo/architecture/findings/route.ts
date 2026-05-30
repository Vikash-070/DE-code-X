/**
 * POST /api/repo/architecture/findings
 * Body: { owner, repo, branch? }
 *
 * Stage 3b — repo-level "Notable Findings" (dead code, gated features, perf
 * risk, …). Reads a BOUNDED set of high-signal files and makes ONE larger paid
 * OpenRouter call, so it runs only on an explicit request (confirm-before-spend).
 * Cached in-process by anchor signature.
 *
 * SECURITY: key decrypted server-side only; never returned.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse }       from "next/server";

import { prisma }             from "@/lib/prisma";
import { decryptKey }         from "@/server/ai/encryption";
import { OPENROUTER_KEY_PREFIX } from "@/server/ai/constants";
import { fetchRepoTree }      from "@/services/github/tree";
import { fetchFileContent }   from "@/services/github/file";
import { buildFileMap, isSensitivePath } from "@/server/repo/file-map";
import { selectAnchors }      from "@/server/repo/import-graph";
import { findNotableIssues, type NotableFinding } from "@/server/repo/findings";
import { rateLimit, sameOrigin } from "@/server/security/guards";

export const dynamic = "force-dynamic";

/** Files read for the synthesis pass — bounded to control token cost. */
const MAX_FINDING_FILES = 20;

const findingsCache = new Map<string, NotableFinding[]>();

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

interface FindingsRequest { owner?: string; repo?: string; branch?: string; }

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  // Rate limit: heavy multi-file paid call — 6 per 5 minutes per user.
  const rl = rateLimit(`findings:${userId}`, 6, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: FindingsRequest;
  try { body = (await request.json()) as FindingsRequest; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const owner = body.owner?.trim();
  const repo  = body.repo?.trim();
  const branch = body.branch?.trim() ?? "main";
  if (!owner || !repo) return NextResponse.json({ error: "owner and repo are required" }, { status: 422 });
  const repoFullName = `${owner}/${repo}`;
  const t0 = Date.now();

  // OpenRouter key (paid).
  const keyRecord = await prisma.userProviderKey.findFirst({
    where: { user: { clerkId: userId }, provider: "openrouter", isActive: true },
    select: { encryptedKey: true, model: true },
  }).catch(() => null);
  if (!keyRecord) {
    return NextResponse.json({ error: "No OpenRouter key configured. Add one in Settings → AI Providers." }, { status: 503 });
  }
  let apiKey: string;
  try { apiKey = decryptKey(keyRecord.encryptedKey); }
  catch { return NextResponse.json({ error: "Your OpenRouter key couldn't be decrypted." }, { status: 503 }); }
  if (!apiKey.startsWith(OPENROUTER_KEY_PREFIX)) {
    return NextResponse.json({ error: "Your OpenRouter key format looks invalid (expected sk-or-…)." }, { status: 503 });
  }

  // GitHub token.
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    return NextResponse.json({ error: "Failed to retrieve GitHub token." }, { status: 502 });
  }
  if (!githubToken) return NextResponse.json({ error: "GitHub not connected." }, { status: 401 });

  // Tree → file map → bounded anchors.
  let tree;
  try { tree = await fetchRepoTree(owner, repo, branch, githubToken); }
  catch { return NextResponse.json({ error: `Could not read ${repoFullName}.` }, { status: 502 }); }

  const fileMap = buildFileMap(tree.rawNodes ?? tree.nodes);
  // Defense-in-depth: never feed secret files to the AI provider.
  const safeFiles = fileMap.files.filter((f) => !isSensitivePath(f.path));
  const { anchors } = selectAnchors(safeFiles, MAX_FINDING_FILES);
  if (anchors.length === 0) {
    return NextResponse.json({ findings: [], fromCache: false });
  }

  // Cache by the anchor signature (changes when the high-signal set changes).
  const cacheKey = `${repoFullName}:${fnv1a(anchors.map((a) => a.path).join("|"))}`;
  const cached = findingsCache.get(cacheKey);
  if (cached) return NextResponse.json({ findings: cached, fromCache: true });

  // Fetch anchor contents (bounded, fail-open).
  const results = await Promise.allSettled(
    anchors.map((a) => fetchFileContent(owner, repo, a.path, githubToken!))
  );
  const files = results
    .map((r, i) => (r.status === "fulfilled" ? { path: anchors[i]!.path, content: r.value.content } : null))
    .filter((f): f is { path: string; content: string } => f !== null);

  let findings: NotableFinding[];
  try {
    findings = await findNotableIssues({ files, apiKey, model: keyRecord.model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Findings synthesis failed.";
    console.log(`[findings] failed repo=${repoFullName} err=${msg.slice(0, 100)}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  findingsCache.set(cacheKey, findings);
  console.log(`[findings] served repo=${repoFullName} files=${files.length} findings=${findings.length} duration=${Date.now() - t0}ms`);
  return NextResponse.json({ findings, fromCache: false });
}
