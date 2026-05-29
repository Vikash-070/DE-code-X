/**
 * Fixture: multi-module stored findings for gap-synthesis tests.
 *
 * Mirrors the shape of FileIntelligence rows (repoFullName, branch, filePath,
 * agentId, findings[], analyzedAt) for Atlas, Sentinel, and Pulse — the three
 * modules in GAP_SYNTHESIS_MODULES. Tests use these to exercise the pure
 * getMultiModuleContext()/formatModuleContextForPrompt() logic without a DB.
 *
 * Keep this data import-safe: no prisma, no server-only imports.
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
  agentId:      "atlas" | "sentinel" | "pulse" | "cipher" | "forge";
  findings:     FixtureFinding[];
  /** ISO string — fresh (recent) so staleness annotation is empty. */
  analyzedAt:   string;
}

const FRESH = "2026-05-28T10:00:00Z"; // ~1 day before currentDate 2026-05-29

export const ATLAS_RECORDS: FixtureRecord[] = [
  {
    repoFullName: "owner/repo",
    branch:       "main",
    filePath:     "src/app/structure.ts",
    agentId:      "atlas",
    analyzedAt:   FRESH,
    findings: [
      {
        id: "a1", type: "architecture-signal", title: "No service layer",
        description: "Routes call Prisma directly with no intermediate service boundary",
        confidence: "confirmed", agentReasoning: "12 route files import prisma",
        evidenceLines: { start: 1, end: 4 },
      },
    ],
  },
];

export const SENTINEL_RECORDS: FixtureRecord[] = [
  {
    repoFullName: "owner/repo",
    branch:       "main",
    filePath:     "src/auth/route.ts",
    agentId:      "sentinel",
    analyzedAt:   FRESH,
    findings: [
      {
        id: "s1", type: "security-signal", title: "No rate limiting",
        description: "Auth endpoint has no throttling on failed login attempts",
        confidence: "confirmed", agentReasoning: "no rate-limit middleware found",
        evidenceLines: { start: 20, end: 28 },
      },
    ],
  },
];

export const PULSE_RECORDS: FixtureRecord[] = [
  {
    repoFullName: "owner/repo",
    branch:       "main",
    filePath:     "src/feed/query.ts",
    agentId:      "pulse",
    analyzedAt:   FRESH,
    findings: [
      {
        id: "p1", type: "performance-signal", title: "N+1 query in feed",
        description: "Feed loop issues one query per post instead of a batched join",
        confidence: "inferred", agentReasoning: "loop over posts calls findUnique",
      },
    ],
  },
];

/** All three modules present — full gap-synthesis input. */
export const ALL_MODULE_RECORDS: FixtureRecord[] = [
  ...ATLAS_RECORDS,
  ...SENTINEL_RECORDS,
  ...PULSE_RECORDS,
];
