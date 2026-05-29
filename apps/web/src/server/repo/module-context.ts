/**
 * Module Context — V# intelligence injection.
 *
 * When the user sends a message to V#, we detect the most relevant intelligence
 * module from `matchIntentToAgent()` and load the top stored findings for that
 * module from `FileIntelligence`. Those findings are then injected into the V#
 * system prompt so V# can answer questions grounded in real persisted analysis.
 *
 * Example: "what are the security issues?" →
 *   1. matchIntentToAgent → sentinel
 *   2. getModuleContext("owner/repo", "main", "sentinel", 5)
 *   3. Returns top 5 Sentinel findings sorted confirmed > inferred > speculative
 *   4. Formatted into a compact block, appended to the V# system prompt
 *
 * This is non-blocking: the DB query races a 1s timeout.
 * If findings are absent or the query times out, V# answers without module context.
 *
 * Security: only the owner's repository findings are returned — ownership is
 * enforced at the route level (V# already has an auth check; this query reads
 * from the same FileIntelligence table scoped by repoFullName/branch).
 */

import { prisma }                   from "@/lib/prisma";
import type { AgentId, CipherFinding } from "@/types/intelligence";

// ─── Types ─────────────────────────────────────────────────────

export interface ModuleContextFinding {
  filePath: string;
  finding:  CipherFinding;
}

export interface ModuleContextResult {
  agentId:        AgentId;
  findings:       ModuleContextFinding[];
  /** How many total findings exist before the cap. */
  totalAvailable: number;
}

// ─── Confidence rank for sorting ──────────────────────────────

const CONFIDENCE_RANK: Record<string, number> = {
  confirmed:   3,
  inferred:    2,
  speculative: 1,
};

// ─── Fetcher ───────────────────────────────────────────────────

/**
 * Fetch top stored findings for a specific intelligence module + repository.
 *
 * Returns the top `limit` findings sorted confirmed > inferred > speculative.
 * Returns null if no findings exist or the query fails.
 */
export async function getModuleContext(
  repoFullName: string,
  branch:       string,
  agentId:      AgentId,
  limit         = 5
): Promise<ModuleContextResult | null> {
  try {
    const records = await prisma.fileIntelligence.findMany({
      where:   { repoFullName, branch, agentId },
      orderBy: { analyzedAt: "desc" },
      select:  { filePath: true, findings: true },
      take:    50, // fetch more than `limit` so we can sort by confidence across files
    });

    if (!records.length) return null;

    // Flatten all findings with their file paths
    const all: ModuleContextFinding[] = [];
    for (const record of records) {
      const findings = record.findings as unknown as CipherFinding[];
      for (const f of findings) {
        all.push({ filePath: record.filePath, finding: f });
      }
    }

    const totalAvailable = all.length;
    if (totalAvailable === 0) return null;

    // Sort by confidence descending
    const sorted = all.sort((a, b) => {
      const ra = CONFIDENCE_RANK[a.finding.confidence] ?? 0;
      const rb = CONFIDENCE_RANK[b.finding.confidence] ?? 0;
      return rb - ra;
    });

    return {
      agentId,
      findings:       sorted.slice(0, limit),
      totalAvailable,
    };
  } catch {
    return null;
  }
}

// ─── Prompt formatter ──────────────────────────────────────────

const MODULE_DISPLAY_NAME: Record<AgentId, string> = {
  cipher:   "Cipher (code quality)",
  sentinel: "Sentinel (security)",
  pulse:    "Pulse (performance)",
  atlas:    "Atlas (architecture)",
  forge:    "Forge (implementation plan)",
};

/**
 * Format a ModuleContextResult as a compact block for injection into
 * the V# system prompt. Keeps token usage tight — one line per finding.
 *
 * Example output:
 * ```
 * === Sentinel Intelligence (stored security findings) ===
 * • src/auth/route.ts — SQL injection risk (confirmed, line 42): Raw query concatenation
 * • src/upload/handler.ts — Missing file validation (inferred): No MIME type check
 * [3 more sentinel findings not shown — ask to see more]
 * ```
 */
export function formatModuleContextForPrompt(ctx: ModuleContextResult): string {
  const moduleName = MODULE_DISPLAY_NAME[ctx.agentId] ?? ctx.agentId;
  const shown      = ctx.findings;
  const remaining  = ctx.totalAvailable - shown.length;

  const lines = shown.map(({ filePath, finding }) => {
    const fileName  = filePath.split("/").pop() ?? filePath;
    const lineRef   = finding.evidenceLines
      ? `, line ${finding.evidenceLines.start}`
      : "";
    // Truncate description to 80 chars to stay token-efficient
    const desc = finding.description.slice(0, 80).trimEnd();
    return `• ${fileName} — ${finding.title} (${finding.confidence}${lineRef}): ${desc}`;
  });

  const header  = `=== ${moduleName} — ${ctx.totalAvailable} stored finding${ctx.totalAvailable !== 1 ? "s" : ""} ===`;
  const footer  = remaining > 0
    ? `[${remaining} more ${ctx.agentId} finding${remaining !== 1 ? "s" : ""} not shown]`
    : "";

  return [header, ...lines, ...(footer ? [footer] : [])].join("\n");
}
