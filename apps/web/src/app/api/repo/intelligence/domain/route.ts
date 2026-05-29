/**
 * GET /api/repo/intelligence/domain
 *
 * Returns all persisted intelligence findings for files within a
 * given architectural domain prefix, across all modules.
 *
 * Query params:
 *   owner        — GitHub owner (required)
 *   repo         — GitHub repo name (required)
 *   branch       — branch name (default: "main")
 *   domainPrefix — directory prefix, e.g. "src/server/repo" (required)
 *   agentId      — filter to a single module: cipher|sentinel|pulse|atlas (optional)
 *
 * Response shape:
 *   {
 *     domainPrefix: string,
 *     repoFullName: string,
 *     modules: {
 *       cipher?:   { filePath, findings, analyzedAt }[],
 *       sentinel?: { filePath, findings, analyzedAt }[],
 *       pulse?:    { filePath, findings, analyzedAt }[],
 *       atlas?:    { filePath, findings, analyzedAt }[],
 *     },
 *     totalFindings: number,
 *     fileCount:     number,
 *   }
 *
 * Auth: Clerk (userId required).
 * Repo ownership: user must own a Project that has this Repository.
 * Returns 404 if the repo is not linked to the user's account.
 *
 * SECURITY:
 *   - No GitHub token needed (findings are already in our DB).
 *   - Ownership check via prisma: user → project → repository.
 *   - No raw file contents returned — findings only.
 */

import { auth }          from "@clerk/nextjs/server";
import { NextResponse }  from "next/server";

import { prisma }          from "@/lib/prisma";
import type { CipherFinding, AgentId } from "@/types/intelligence";

export const dynamic = "force-dynamic";

// ─── Response types ───────────────────────────────────────────

interface FileIntelligenceEntry {
  filePath:   string;
  findings:   CipherFinding[];
  analyzedAt: string;
  agentId:    AgentId;
}

interface DomainIntelligenceResponse {
  domainPrefix: string;
  repoFullName: string;
  branch:       string;
  modules: Partial<Record<AgentId, FileIntelligenceEntry[]>>;
  totalFindings: number;
  fileCount:     number;
}

// ─── Route handler ────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── 2. Query params ─────────────────────────────────────────
  const url          = new URL(request.url);
  const owner        = url.searchParams.get("owner")?.trim();
  const repo         = url.searchParams.get("repo")?.trim();
  const branch       = url.searchParams.get("branch")?.trim() ?? "main";
  const domainPrefix = url.searchParams.get("domainPrefix")?.trim();
  const agentIdParam = url.searchParams.get("agentId")?.trim() as AgentId | undefined;

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "owner and repo query params are required" },
      { status: 422 }
    );
  }
  if (!domainPrefix) {
    return NextResponse.json(
      { error: "domainPrefix query param is required" },
      { status: 422 }
    );
  }

  const repoFullName = `${owner}/${repo}`;

  // ── 3. Ownership check ──────────────────────────────────────
  // User must have a Project → Repository linking this repoFullName.
  // This prevents users from reading each other's persisted intelligence.
  const dbUser = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { id: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const linkedRepo = await prisma.repository.findFirst({
    where: {
      fullName: repoFullName,
      project:  { ownerId: dbUser.id },
    },
    select: { id: true },
  });

  if (!linkedRepo) {
    return NextResponse.json(
      { error: `Repository ${repoFullName} is not linked to your account.` },
      { status: 404 }
    );
  }

  // ── 4. Load intelligence for this domain ────────────────────
  // Query all FileIntelligence records for:
  //   - This repo+branch
  //   - filePath starts with domainPrefix (OR is __repo__ for Atlas)
  //   - Optionally filtered by agentId
  const whereClause: NonNullable<Parameters<typeof prisma.fileIntelligence.findMany>[0]>["where"] = {
    repoFullName,
    branch,
    OR: [
      { filePath: { startsWith: domainPrefix } },
      { filePath: "__repo__", agentId: "atlas" }, // Atlas is always repo-level
    ],
  };

  if (agentIdParam) {
    // Override OR with single agentId filter
    delete (whereClause as Record<string, unknown>).OR;
    (whereClause as Record<string, unknown>).agentId   = agentIdParam;
    (whereClause as Record<string, unknown>).filePath  = { startsWith: domainPrefix };
  }

  const records = await prisma.fileIntelligence.findMany({
    where:   whereClause,
    orderBy: [{ agentId: "asc" }, { filePath: "asc" }],
    select: {
      filePath:   true,
      agentId:    true,
      findings:   true,
      analyzedAt: true,
    },
  });

  // ── 5. Group by module ───────────────────────────────────────
  const modules: Partial<Record<AgentId, FileIntelligenceEntry[]>> = {};

  for (const record of records) {
    const agentId = record.agentId as AgentId;
    const findings = record.findings as unknown as CipherFinding[];

    if (!modules[agentId]) modules[agentId] = [];
    modules[agentId]!.push({
      filePath:   record.filePath,
      findings,
      analyzedAt: record.analyzedAt.toISOString(),
      agentId,
    });
  }

  // ── 6. Compute totals ────────────────────────────────────────
  const allEntries = Object.values(modules).flat();
  const totalFindings = allEntries.reduce((sum, e) => sum + e.findings.length, 0);
  const uniqueFiles = new Set(
    allEntries.filter(e => e.filePath !== "__repo__").map(e => e.filePath)
  ).size;

  const response: DomainIntelligenceResponse = {
    domainPrefix,
    repoFullName,
    branch,
    modules,
    totalFindings,
    fileCount: uniqueFiles,
  };

  return NextResponse.json(response);
}
