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
  /** When the source record was last analyzed — drives staleness annotation. */
  analyzedAt: Date;
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

// ─── Staleness ────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Findings older than this (in days) get a "(analyzed N days ago)" annotation
 * in the prompt so V# can weight fresh evidence over stale evidence.
 *
 * Default 14 days. Override with MODULE_CONTEXT_STALENESS_DAYS (Decision #8).
 * Findings are annotated, NOT dropped — stale evidence is still evidence,
 * V# just needs to know its age.
 */
function stalenessMaxAgeDays(): number {
  const raw = Number(process.env.MODULE_CONTEXT_STALENESS_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
}

/**
 * Returns a " (analyzed N days ago)" suffix when the finding is older than the
 * staleness window, or "" when it is fresh. Pure — clock injected for tests.
 */
export function stalenessAnnotation(
  analyzedAt: Date,
  now:        number = Date.now(),
  maxAgeDays: number = stalenessMaxAgeDays()
): string {
  const ageDays = Math.floor((now - new Date(analyzedAt).getTime()) / MS_PER_DAY);
  return ageDays > maxAgeDays ? ` (analyzed ${ageDays} days ago)` : "";
}

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
      select:  { filePath: true, findings: true, analyzedAt: true },
      take:    50, // fetch more than `limit` so we can sort by confidence across files
    });

    if (!records.length) return null;

    // ── filePath dedup (Decision #9) ──────────────────────────
    // Re-analysis can leave multiple rows for the same filePath. Records are
    // ordered analyzedAt desc, so the FIRST occurrence of a path is the most
    // recent — keep it and drop older duplicates. Without this, a single file
    // can contribute mixed stale + fresh findings to the same answer.
    const seenPaths = new Set<string>();
    const freshest = records.filter((r) => {
      if (seenPaths.has(r.filePath)) return false;
      seenPaths.add(r.filePath);
      return true;
    });

    // Flatten all findings with their file paths
    const all: ModuleContextFinding[] = [];
    for (const record of freshest) {
      const findings = record.findings as unknown as CipherFinding[];
      for (const f of findings) {
        all.push({ filePath: record.filePath, finding: f, analyzedAt: record.analyzedAt });
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

  const lines = shown.map(({ filePath, finding, analyzedAt }) => {
    const fileName  = filePath.split("/").pop() ?? filePath;
    const lineRef   = finding.evidenceLines
      ? `, line ${finding.evidenceLines.start}`
      : "";
    // Truncate description to 80 chars to stay token-efficient
    const desc = finding.description.slice(0, 80).trimEnd();
    // Staleness annotation — empty for fresh findings, "(analyzed N days ago)" for old ones.
    const stale = stalenessAnnotation(analyzedAt);
    return `• ${fileName} — ${finding.title} (${finding.confidence}${lineRef}): ${desc}${stale}`;
  });

  const header  = `=== ${moduleName} — ${ctx.totalAvailable} stored finding${ctx.totalAvailable !== 1 ? "s" : ""} ===`;
  const footer  = remaining > 0
    ? `[${remaining} more ${ctx.agentId} finding${remaining !== 1 ? "s" : ""} not shown]`
    : "";

  return [header, ...lines, ...(footer ? [footer] : [])].join("\n");
}

// ─── Multi-module context (gap synthesis) ─────────────────────

/**
 * Default module set for capability-gap synthesis.
 * Atlas (architecture shape) + Sentinel (security) + Pulse (performance)
 * together give V# enough cross-cutting signal to reason about what a
 * codebase is MISSING, not just what it contains.
 */
export const GAP_SYNTHESIS_MODULES: AgentId[] = ["atlas", "sentinel", "pulse"];

/**
 * Fetch and concatenate stored findings across multiple intelligence modules
 * for cross-module gap synthesis (Decision #7).
 *
 * Each module is loaded with getModuleContext() (which already applies filePath
 * dedup), then formatted and joined with blank lines. The result is a single
 * block with one "=== <Module> — N stored findings ===" header per module that
 * returned findings — buildVHashSystemPrompt() counts those headers to decide
 * whether to switch into gap-synthesis mode.
 *
 * Behaviour:
 *   - All modules return findings → block with one header per module.
 *   - Partial (some modules empty) → block with only the modules that had data.
 *   - All modules empty → returns null (caller injects the "run Atlas first"
 *     directive rather than an empty intelligence block).
 *
 * The three reads run in parallel (Promise.all). Returns null on any failure —
 * gap synthesis degrades to V#'s normal reasoning, never a 500.
 */
export async function getMultiModuleContext(
  repoFullName:   string,
  branch:         string,
  agentIds:       AgentId[] = GAP_SYNTHESIS_MODULES,
  limitPerModule  = 5
): Promise<string | null> {
  try {
    const results = await Promise.all(
      agentIds.map((id) => getModuleContext(repoFullName, branch, id, limitPerModule))
    );

    const blocks = results
      .filter((r): r is ModuleContextResult => r !== null)
      .map((r) => formatModuleContextForPrompt(r));

    if (!blocks.length) return null;

    return blocks.join("\n\n");
  } catch {
    return null;
  }
}
