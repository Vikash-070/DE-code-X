/**
 * Fixture: duplicate FileIntelligence rows for the same filePath.
 *
 * Re-analysis can leave multiple rows for one (repoFullName, branch, filePath,
 * agentId) snapshot in history. getModuleContext() orders by analyzedAt desc
 * and keeps only the FIRST occurrence of each filePath (Decision #9), so the
 * NEWER row wins and the older one is dropped — preventing a single file from
 * contributing mixed stale + fresh findings to one answer.
 *
 * Import-safe: plain constants, no prisma.
 */

export interface FixtureFinding {
  id:             string;
  type:           string;
  title:          string;
  description:    string;
  confidence:     "confirmed" | "inferred" | "speculative";
  agentReasoning: string;
  evidenceLines?: { start: number; end: number };
}

export interface FixtureRecord {
  repoFullName: string;
  branch:       string;
  filePath:     string;
  agentId:      "sentinel";
  findings:     FixtureFinding[];
  analyzedAt:   string;
}

/**
 * Two rows, same filePath, different analyzedAt. Provided in analyzedAt-desc
 * order (newest first), mirroring the Prisma `orderBy: { analyzedAt: "desc" }`.
 * The newest row (NEW finding) must survive dedup; the OLD one must drop.
 */
export const DUPLICATE_FILE_RECORDS: FixtureRecord[] = [
  {
    repoFullName: "owner/repo",
    branch:       "main",
    filePath:     "src/auth/route.ts",
    agentId:      "sentinel",
    analyzedAt:   "2026-05-28T12:00:00Z", // newest — keep
    findings: [
      {
        id: "new1", type: "security-signal", title: "NEW finding",
        description: "Current analysis: missing CSRF token validation",
        confidence: "confirmed", agentReasoning: "no csrf check on POST handler",
        evidenceLines: { start: 30, end: 34 },
      },
    ],
  },
  {
    repoFullName: "owner/repo",
    branch:       "main",
    filePath:     "src/auth/route.ts",
    agentId:      "sentinel",
    analyzedAt:   "2026-04-01T09:00:00Z", // older — drop
    findings: [
      {
        id: "old1", type: "security-signal", title: "OLD finding",
        description: "Stale analysis from a previous run",
        confidence: "inferred", agentReasoning: "earlier pass",
      },
    ],
  },
];
