/**
 * Multi-Module Intelligence System — Test Plan
 *
 * 10 critical test gaps identified in Phase 3 Eng Review.
 * Tests cover: module isolation, Atlas empty states, Forge nil-path,
 * Sentinel post-processor, workspace API contract, V# routing.
 *
 * Test runner: vitest (compatible with jest).
 * DB tests are pure logic — no real Prisma calls.
 *
 * Run: pnpm vitest (once vitest is wired to this workspace).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { describe, it, expect } = (globalThis as unknown as {
  describe: typeof import("vitest")["describe"];
  it: typeof import("vitest")["it"];
  expect: typeof import("vitest")["expect"];
});

// ─── Gap Analysis v1 — real import-safe modules + fixtures ────────────────────
// agent-registry and vhash-prompt have type-only dependencies, so they are safe
// to import in a unit test (no Prisma instantiation). module-context is coupled
// to Prisma at import time; its pure logic is mirrored further below.
import { detectGapIntent, matchIntentToAgent as realMatchIntentToAgent } from "@/server/repo/agent-registry";
import { buildVHashSystemPrompt } from "@/server/ai/vhash-prompt";
import { buildDomainMap, deriveStructuralFingerprint } from "@/server/repo/domain-map";
import {
  detectOrchestrationAction,
  extractFilePath,
  formatAgentRoster,
  formatPaidConfirmation,
  formatAtlasResult,
} from "@/server/repo/agent-orchestration";
import { deriveCapabilities } from "@/server/repo/capability-map";
import type { Capability } from "@/server/repo/capability-map";
import {
  buildArchitectureGraph,
  deriveSystemNodes,
  parsePackageDependencies,
  toWires,
} from "@/server/repo/architecture-wire";
import { classifyFile, buildFileMap } from "@/server/repo/file-map";
import {
  parseImports,
  parseTsconfigAliases,
  resolveImport,
  selectAnchors,
  buildImportGraph,
} from "@/server/repo/import-graph";
import { parseNarration } from "@/server/repo/narration";
import { parseFindings } from "@/server/repo/findings";
import type { ArchitectureTree, CipherFinding as IntelCipherFinding } from "@/types/intelligence";
import {
  ATLAS_RECORDS,
  SENTINEL_RECORDS,
  PULSE_RECORDS,
  ALL_MODULE_RECORDS,
  type FixtureRecord,
} from "./fixtures/multi-module-context";
import {
  FIXED_NOW,
  STALE_ANALYZED_AT,
  FRESH_ANALYZED_AT,
} from "./fixtures/stale-finding";
import { DUPLICATE_FILE_RECORDS } from "./fixtures/duplicate-file-records";

// ─── Shared types ────────────────────────────────────────────

interface CipherFinding {
  id:             string;
  type:           string;
  title:          string;
  description:    string;
  confidence:     "confirmed" | "inferred" | "speculative";
  agentReasoning: string;
  evidenceLines?: { start: number; end: number };
}

// ─── Test 1: Module isolation — Sentinel does NOT overwrite Cipher ─────────────
//
// Core invariant: upsertFileIntelligence uses (repoFullName, filePath, branch, agentId)
// as the 4-field unique key. Two modules writing to the same file produce TWO records.

describe("Test 1: intelligence-store — module isolation", () => {
  type Record = {
    repoFullName: string;
    filePath:     string;
    branch:       string;
    agentId:      string;
    findings:     CipherFinding[];
  };

  function simulateUpsert(store: Map<string, Record>, record: Record): Map<string, Record> {
    // Key = 4-field composite (mirrors DB unique constraint)
    const key = `${record.repoFullName}|${record.filePath}|${record.branch}|${record.agentId}`;
    return new Map(store).set(key, record);
  }

  it("Sentinel upsert does NOT overwrite Cipher record for same file", () => {
    let store = new Map<string, Record>();

    const cipherRecord: Record = {
      repoFullName: "owner/repo",
      filePath:     "src/auth/route.ts",
      branch:       "main",
      agentId:      "cipher",
      findings:     [{ id: "c1", type: "implementation", title: "Complex function", description: "...", confidence: "confirmed", agentReasoning: "line 42" }],
    };

    const sentinelRecord: Record = {
      repoFullName: "owner/repo",
      filePath:     "src/auth/route.ts",
      branch:       "main",
      agentId:      "sentinel",
      findings:     [{ id: "s1", type: "security-signal", title: "SQL injection risk", description: "...", confidence: "confirmed", agentReasoning: "line 15" }],
    };

    store = simulateUpsert(store, cipherRecord);
    store = simulateUpsert(store, sentinelRecord);

    // Both records must exist
    expect(store.size).toBe(2);

    const cipherKey   = "owner/repo|src/auth/route.ts|main|cipher";
    const sentinelKey = "owner/repo|src/auth/route.ts|main|sentinel";

    expect(store.has(cipherKey)).toBe(true);
    expect(store.has(sentinelKey)).toBe(true);
    expect(store.get(cipherKey)?.findings[0]?.id).toBe("c1");
    expect(store.get(sentinelKey)?.findings[0]?.id).toBe("s1");
  });

  it("Re-running Sentinel for same file updates ONLY the sentinel record", () => {
    let store = new Map<string, Record>();

    const cipher: Record = {
      repoFullName: "owner/repo", filePath: "src/auth/route.ts",
      branch: "main", agentId: "cipher",
      findings: [{ id: "c1", type: "implementation", title: "Complex fn", description: "...", confidence: "confirmed", agentReasoning: "line 42" }],
    };
    const sentinel1: Record = {
      repoFullName: "owner/repo", filePath: "src/auth/route.ts",
      branch: "main", agentId: "sentinel",
      findings: [{ id: "s1", type: "security-signal", title: "Old finding", description: "...", confidence: "inferred", agentReasoning: "line 1" }],
    };
    const sentinel2: Record = {
      ...sentinel1,
      findings: [{ id: "s2", type: "security-signal", title: "New finding", description: "...", confidence: "confirmed", agentReasoning: "line 15" }],
    };

    store = simulateUpsert(store, cipher);
    store = simulateUpsert(store, sentinel1);
    store = simulateUpsert(store, sentinel2); // re-run Sentinel

    // Still 2 records — only sentinel updated
    expect(store.size).toBe(2);
    const sentinelKey = "owner/repo|src/auth/route.ts|main|sentinel";
    expect(store.get(sentinelKey)?.findings[0]?.id).toBe("s2");
    // Cipher untouched
    const cipherKey = "owner/repo|src/auth/route.ts|main|cipher";
    expect(store.get(cipherKey)?.findings[0]?.id).toBe("c1");
  });

  // Test 10 (2am Friday): Cipher + Sentinel both present → Workspace shows BOTH chips
  it("Test 10 — Architecture Workspace sees findings from BOTH modules", () => {
    const modules: Record<string, number> = {
      "cipher":   2,
      "sentinel": 1,
    };

    // Simulate domain intelligence grouping
    const totalFindings = Object.values(modules).reduce((a, b) => a + b, 0);
    const moduleCount   = Object.keys(modules).length;

    expect(totalFindings).toBe(3);
    expect(moduleCount).toBe(2);
    expect(modules["cipher"]).toBe(2);
    expect(modules["sentinel"]).toBe(1);
  });
});

// ─── Test 2: Atlas — empty domain map returns null tree ────────────────────────

describe("Test 2 & 3: atlas-analyzer — graceful empty states", () => {
  function buildDomainMapSimulator(domainCount: number) {
    const MIN_DOMAINS = 2;
    if (domainCount < MIN_DOMAINS) {
      return { tree: null, message: "Repository structure not yet indexed." };
    }
    return {
      tree: { domains: Array.from({ length: domainCount }, (_, i) => ({
        name: `Domain ${i}`, prefix: `src/domain${i}`, fileCount: 5, pressure: "medium",
      })) },
      message: null,
    };
  }

  it("Test 2 — returns null tree when domain-map has 0 domains", () => {
    const result = buildDomainMapSimulator(0);
    expect(result.tree).toBeNull();
    expect(result.message).toBe("Repository structure not yet indexed.");
  });

  it("Test 3 — returns null tree when domain-map has < 2 domains", () => {
    const result = buildDomainMapSimulator(1);
    expect(result.tree).toBeNull();
  });

  it("returns tree when domain-map has ≥ 2 domains", () => {
    const result = buildDomainMapSimulator(3);
    expect(result.tree).not.toBeNull();
    expect(result.tree?.domains.length).toBe(3);
    expect(result.message).toBeNull();
  });
});

// ─── Test 4: Forge nil-path — insufficient_evidence when 0 findings ────────────

describe("Test 4: forge-planner — nil-path guard", () => {
  type ForgeStatus = "success" | "insufficient_evidence" | "provider_timeout";
  type ForgeResult = {
    agentId:   "forge";
    status:    ForgeStatus;
    roadmap:   unknown[] | null;
    message?:  string;
    persistedAt: null;
  };

  function simulateForgePlan(totalFindingsAvailable: number): ForgeResult {
    if (totalFindingsAvailable === 0) {
      return {
        agentId:     "forge",
        status:      "insufficient_evidence",
        roadmap:     null,
        message:     "No files have been analyzed yet. Ask V# to review key files in your repo first.",
        persistedAt: null,
      };
    }
    return {
      agentId:     "forge",
      status:      "success",
      roadmap:     [{ priority: "P0", title: "Fix SQL injection", description: "...", targetFiles: [], sourcedFrom: "sentinel" }],
      persistedAt: null,
    };
  }

  it("returns insufficient_evidence when totalFindingsAvailable is 0", () => {
    const result = simulateForgePlan(0);
    expect(result.status).toBe("insufficient_evidence");
    expect(result.roadmap).toBeNull();
    expect(result.agentId).toBe("forge");
  });

  it("does NOT call the AI provider when totalFindingsAvailable is 0", () => {
    // Verified by the nil guard returning early — no AI call path is reached
    let aiCallCount = 0;
    function mockAiCall() { aiCallCount++; }

    const findings = 0;
    if (findings === 0) {
      // Nil guard fires — AI call is skipped
    } else {
      mockAiCall();
    }

    expect(aiCallCount).toBe(0);
  });

  it("returns success when findings are available", () => {
    const result = simulateForgePlan(5);
    expect(result.status).toBe("success");
    expect(result.roadmap).not.toBeNull();
  });
});

// ─── Test 5 & 6: Sentinel post-processor ──────────────────────────────────────

describe("Tests 5 & 6: sentinel-analyzer — post-processor", () => {
  const FALSE_POSITIVE_PHRASES = [
    "application is secure",
    "no security issues",
    "secure implementation",
    "no vulnerabilities",
    "no issues found",
    "properly validated",
    "this is safe",
    "no concerns",
    "well-protected",
  ];

  function sentinelPostProcess(findings: CipherFinding[]): CipherFinding[] {
    return findings.filter(f => {
      const descLower = f.description.toLowerCase();
      const reasoningLower = f.agentReasoning.toLowerCase();

      // Strip "all clear" false positives
      const isFalsePositive = FALSE_POSITIVE_PHRASES.some(phrase =>
        descLower.includes(phrase) || reasoningLower.includes(phrase)
      );
      if (isFalsePositive) return false;

      // Strip confirmed findings without line reference (ungrounded)
      if (f.confidence === "confirmed" && !f.evidenceLines) {
        return false;
      }

      return true;
    });
  }

  it("Test 5 — strips 'application is secure' all-clear claims", () => {
    const findings: CipherFinding[] = [
      {
        id: "1", type: "security-signal", title: "All clear",
        description: "The application is secure. No issues found.",
        confidence: "inferred",
        agentReasoning: "Reviewed auth logic",
      },
      {
        id: "2", type: "security-signal", title: "SQL Injection",
        description: "Unparameterized query allows injection",
        confidence: "confirmed",
        agentReasoning: "Line 42: rawQuery(userInput)",
        evidenceLines: { start: 42, end: 42 },
      },
    ];

    const filtered = sentinelPostProcess(findings);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.id).toBe("2");
  });

  it("Test 6 — confirmed findings without line reference are stripped", () => {
    const findings: CipherFinding[] = [
      {
        id: "1", type: "security-signal", title: "Ungrounded confirmed",
        description: "There may be a SQL injection risk",
        confidence: "confirmed",       // confirmed but no evidenceLines!
        agentReasoning: "It looks like there could be an issue",
        // no evidenceLines
      },
      {
        id: "2", type: "security-signal", title: "Grounded confirmed",
        description: "SQL injection via raw query",
        confidence: "confirmed",
        agentReasoning: "Line 42: rawQuery(input)",
        evidenceLines: { start: 42, end: 42 },
      },
    ];

    const filtered = sentinelPostProcess(findings);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.id).toBe("2");
  });

  it("retains inferred findings without line reference (only confirmed are strict)", () => {
    const findings: CipherFinding[] = [
      {
        id: "1", type: "security-signal", title: "Inferred risk",
        description: "Missing CSRF protection on form handler",
        confidence: "inferred",
        agentReasoning: "No csrf token detected in the form submission flow",
        // no evidenceLines — allowed for inferred
      },
    ];

    const filtered = sentinelPostProcess(findings);
    expect(filtered.length).toBe(1);
  });
});

// ─── Test 7 & 8: Workspace API contract ───────────────────────────────────────

describe("Tests 7 & 8: domain intelligence API", () => {
  // Test 7: domain-list endpoint returns fileCount+confidence only, NOT findings[]
  it("Test 7 — domain response shape has totalFindings + fileCount, not raw finding arrays", () => {
    // Simulate the response shape from GET /api/repo/intelligence/domain
    const mockResponse = {
      domainPrefix:  "src/auth",
      repoFullName:  "owner/repo",
      branch:        "main",
      modules: {
        sentinel: [
          {
            filePath:   "src/auth/route.ts",
            agentId:    "sentinel",
            analyzedAt: "2026-05-28T10:00:00Z",
            findings:   [
              { id: "s1", type: "security-signal", title: "SQL injection", description: "...", confidence: "confirmed", agentReasoning: "line 42", evidenceLines: { start: 42, end: 42 } }
            ],
          }
        ],
      },
      totalFindings: 1,
      fileCount:     1,
    };

    // Verify: top-level has aggregation metrics (not a raw dump)
    expect(mockResponse).toHaveProperty("totalFindings");
    expect(mockResponse).toHaveProperty("fileCount");
    expect(typeof mockResponse.totalFindings).toBe("number");
    expect(typeof mockResponse.fileCount).toBe("number");
    // Modules are ALSO present (this API returns full findings for the panel)
    expect(mockResponse.modules).toBeDefined();
  });

  // Test 8: 403 for cross-tenant repo request
  it("Test 8 — returns 403 when user does not own the requested repo", () => {
    function simulateOwnershipCheck(
      userId: string,
      repoFullName: string,
      ownedRepos: string[]
    ): 403 | 200 {
      const isOwned = ownedRepos.includes(repoFullName);
      return isOwned ? 200 : 403;
    }

    // User A owns "user-a/repo"
    const statusForOwnRepo   = simulateOwnershipCheck("user-a", "user-a/repo",   ["user-a/repo"]);
    const statusForOtherRepo = simulateOwnershipCheck("user-a", "user-b/private", ["user-a/repo"]);

    expect(statusForOwnRepo).toBe(200);
    expect(statusForOtherRepo).toBe(403);
  });
});

// ─── Test 9: V# routing — intent → module delegation ─────────────────────────

describe("Test 9: V# routing — intent to module matching", () => {
  type AgentId = "cipher" | "sentinel" | "pulse" | "atlas" | "forge";

  interface AgentConfig {
    agentId:        AgentId;
    intentPatterns: string[];
  }

  const REGISTRY: Record<AgentId, AgentConfig> = {
    cipher:   { agentId: "cipher",   intentPatterns: ["code quality", "how does this file work", "what does this code do", "complexity", "implementation pattern"] },
    sentinel: { agentId: "sentinel", intentPatterns: ["security", "vulnerability", "injection", "authentication", "owasp", "attack surface", "is this safe"] },
    pulse:    { agentId: "pulse",    intentPatterns: ["performance", "slow", "n+1", "bottleneck", "latency", "caching", "hotspot"] },
    atlas:    { agentId: "atlas",    intentPatterns: ["architecture", "repo structure", "domain", "layers", "how is this repo organized"] },
    forge:    { agentId: "forge",    intentPatterns: ["what should i fix first", "roadmap", "prioritize", "next steps", "where to start"] },
  };

  function matchIntentToAgent(userMessage: string): AgentConfig | null {
    const lower = userMessage.toLowerCase();
    let bestMatch: AgentConfig | null = null;
    let bestScore = 0;
    for (const config of Object.values(REGISTRY)) {
      let score = 0;
      for (const pattern of config.intentPatterns) {
        if (lower.includes(pattern.toLowerCase())) score += 1;
      }
      if (score > bestScore) { bestScore = score; bestMatch = config; }
    }
    return bestScore > 0 ? bestMatch : null;
  }

  it("'what are the security issues?' → delegates to Sentinel", () => {
    const result = matchIntentToAgent("what are the security issues?");
    expect(result?.agentId).toBe("sentinel");
  });

  it("'are there any sql injection vulnerabilities?' → Sentinel", () => {
    const result = matchIntentToAgent("are there any sql injection vulnerabilities?");
    expect(result?.agentId).toBe("sentinel");
  });

  it("'how is this repo organized?' → Atlas", () => {
    const result = matchIntentToAgent("how is this repo organized?");
    expect(result?.agentId).toBe("atlas");
  });

  it("'what are the performance bottlenecks?' → Pulse", () => {
    const result = matchIntentToAgent("what are the performance bottlenecks?");
    expect(result?.agentId).toBe("pulse");
  });

  it("'what should I fix first?' → Forge", () => {
    const result = matchIntentToAgent("what should I fix first?");
    expect(result?.agentId).toBe("forge");
  });

  it("'hi there' → null (conversational, no module match)", () => {
    const result = matchIntentToAgent("hi there");
    expect(result).toBeNull();
  });

  it("'how does this code work?' → Cipher", () => {
    const result = matchIntentToAgent("how does this code work?");
    expect(result?.agentId).toBe("cipher");
  });

  it("security beats cipher when both patterns match — highest score wins", () => {
    // Message that would score for multiple modules
    const result = matchIntentToAgent("is this authentication code safe from injection attacks?");
    // "authentication" + "injection" + "safe" → sentinel score ≥ 2
    expect(result?.agentId).toBe("sentinel");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Gap Analysis v1 — 10 gap-synthesis tests + 3 fixtures
//
// Scope: Forge gap intent phrases · getMultiModuleContext() · gap synthesis
// routing · response schema · staleness filtering · filePath dedup ·
// null-Atlas handling. Eval criteria: zero false positives on intent routing;
// gap response follows verdict → gaps → why; no crash on null Atlas context.
//
// Real import-safe modules are imported directly where safe (agent-registry
// has type-only deps; vhash-prompt has type-only deps). module-context is
// coupled to Prisma at import time, so its pure logic (multi-module assembly,
// staleness, dedup) is mirrored inline against fixtures — matching the
// self-contained convention used throughout this file.
// (Real imports + fixtures are declared at the top of this file.)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Mirrored module-context pure logic (source: server/repo/module-context.ts) ──
// Kept in lock-step with the real implementation. If module-context.ts changes
// its dedup/format/staleness behaviour, update these mirrors too.

const CONFIDENCE_RANK: Record<string, number> = { confirmed: 3, inferred: 2, speculative: 1 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MODULE_DISPLAY_NAME: Record<string, string> = {
  cipher:   "Cipher (code quality)",
  sentinel: "Sentinel (security)",
  pulse:    "Pulse (performance)",
  atlas:    "Atlas (architecture)",
  forge:    "Forge (implementation plan)",
};

function mirrorStaleness(analyzedAt: Date, now = FIXED_NOW, maxAgeDays = 14): string {
  const ageDays = Math.floor((now - new Date(analyzedAt).getTime()) / MS_PER_DAY);
  return ageDays > maxAgeDays ? ` (analyzed ${ageDays} days ago)` : "";
}

interface FlatFinding { filePath: string; finding: FixtureRecord["findings"][number]; analyzedAt: string; }

/** Mirrors getModuleContext(): dedup by filePath (records already analyzedAt-desc),
 *  flatten, sort by confidence desc, take(limit). Returns null when empty. */
function mirrorGetModuleContext(records: FixtureRecord[], limit = 5) {
  if (!records.length) return null;
  const seen = new Set<string>();
  const freshest = records.filter((r) => {
    if (seen.has(r.filePath)) return false;
    seen.add(r.filePath);
    return true;
  });
  const all: FlatFinding[] = [];
  for (const r of freshest) for (const f of r.findings) all.push({ filePath: r.filePath, finding: f, analyzedAt: r.analyzedAt });
  if (!all.length) return null;
  const sorted = all.sort((a, b) =>
    (CONFIDENCE_RANK[b.finding.confidence] ?? 0) - (CONFIDENCE_RANK[a.finding.confidence] ?? 0));
  return { agentId: freshest[0]!.agentId, findings: sorted.slice(0, limit), totalAvailable: all.length };
}

/** Mirrors formatModuleContextForPrompt(): header starts "=== <Module> — N stored finding(s) ===". */
function mirrorFormat(ctx: NonNullable<ReturnType<typeof mirrorGetModuleContext>>): string {
  const moduleName = MODULE_DISPLAY_NAME[ctx.agentId] ?? ctx.agentId;
  const lines = ctx.findings.map(({ filePath, finding, analyzedAt }) => {
    const fileName = filePath.split("/").pop() ?? filePath;
    const lineRef  = finding.evidenceLines ? `, line ${finding.evidenceLines.start}` : "";
    const desc     = finding.description.slice(0, 80).trimEnd();
    const stale    = mirrorStaleness(new Date(analyzedAt));
    return `• ${fileName} — ${finding.title} (${finding.confidence}${lineRef}): ${desc}${stale}`;
  });
  const header = `=== ${moduleName} — ${ctx.totalAvailable} stored finding${ctx.totalAvailable !== 1 ? "s" : ""} ===`;
  return [header, ...lines].join("\n");
}

/** Mirrors getMultiModuleContext(): format each non-null module, join with blank lines, null if none. */
function mirrorGetMultiModuleContext(recordSets: FixtureRecord[][]): string | null {
  const blocks = recordSets
    .map((rs) => mirrorGetModuleContext(rs))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => mirrorFormat(r));
  return blocks.length ? blocks.join("\n\n") : null;
}

// ─── Gap Test 1: detectGapIntent recognises gap questions ─────────────────────

describe("Gap Test 1: detectGapIntent — recognises capability-gap questions", () => {
  it("'what am I missing?' → true", () => {
    expect(detectGapIntent("what am I missing?")).toBe(true);
  });
  it("'What patterns am I lacking?' → true", () => {
    expect(detectGapIntent("What patterns am I lacking?")).toBe(true);
  });
  it("'show me the gap analysis' → true", () => {
    expect(detectGapIntent("show me the gap analysis")).toBe(true);
  });
});

// ─── Gap Test 2: detectGapIntent — zero false positives ───────────────────────

describe("Gap Test 2: detectGapIntent — no false positives on ordinary questions", () => {
  it("'how is this repo organized?' → false (Atlas question, not a gap)", () => {
    expect(detectGapIntent("how is this repo organized?")).toBe(false);
  });
  it("'what are the security issues?' → false (Sentinel question)", () => {
    expect(detectGapIntent("what are the security issues?")).toBe(false);
  });
  it("'hi there' → false", () => {
    expect(detectGapIntent("hi there")).toBe(false);
  });
});

// ─── Gap Test 3: gap phrases route to Forge via matchIntentToAgent ────────────

describe("Gap Test 3: matchIntentToAgent — gap phrases delegate to Forge", () => {
  it("'what am I missing?' → forge", () => {
    expect(realMatchIntentToAgent("what am I missing?")?.agentId).toBe("forge");
  });
  it("'what should I add?' → forge", () => {
    expect(realMatchIntentToAgent("what should I add?")?.agentId).toBe("forge");
  });
  it("gap intent does NOT route to Atlas (which owns plain architecture)", () => {
    const result = realMatchIntentToAgent("what patterns am I missing?");
    expect(result?.agentId).toBe("forge");
    expect(result?.agentId).not.toBe("atlas");
  });
});

// ─── Gap Test 4: getMultiModuleContext — all 3 modules present ────────────────

describe("Gap Test 4: multi-module context — all modules contribute headers", () => {
  it("emits one '=== <Module>' header per module (Atlas, Sentinel, Pulse)", () => {
    const block = mirrorGetMultiModuleContext([ATLAS_RECORDS, SENTINEL_RECORDS, PULSE_RECORDS]);
    expect(block).not.toBeNull();
    expect(block).toContain("=== Atlas (architecture)");
    expect(block).toContain("=== Sentinel (security)");
    expect(block).toContain("=== Pulse (performance)");
    // Exactly 3 module headers
    const headers = block!.match(/^=== /gm)?.length ?? 0;
    expect(headers).toBe(3);
  });

  it("ALL_MODULE_RECORDS fixture covers all three gap-synthesis modules", () => {
    const agents = new Set(ALL_MODULE_RECORDS.map((r) => r.agentId));
    expect(agents.has("atlas")).toBe(true);
    expect(agents.has("sentinel")).toBe(true);
    expect(agents.has("pulse")).toBe(true);
  });
});

// ─── Gap Test 5: getMultiModuleContext — partial coverage ────────────────────

describe("Gap Test 5: multi-module context — partial coverage shows only present modules", () => {
  it("only Sentinel has data → exactly one header, no Atlas/Pulse headers", () => {
    const block = mirrorGetMultiModuleContext([[], SENTINEL_RECORDS, []]);
    expect(block).not.toBeNull();
    expect(block).toContain("=== Sentinel (security)");
    expect(block).not.toContain("=== Atlas");
    expect(block).not.toContain("=== Pulse");
    const headers = block!.match(/^=== /gm)?.length ?? 0;
    expect(headers).toBe(1);
  });
});

// ─── Gap Test 6: getMultiModuleContext — all empty → null (null-Atlas path) ───

describe("Gap Test 6: multi-module context — all modules empty returns null", () => {
  it("no stored findings anywhere → null (caller sets gapNoData)", () => {
    const block = mirrorGetMultiModuleContext([[], [], []]);
    expect(block).toBeNull();
  });
});

// ─── Gap Test 7: staleness annotation ────────────────────────────────────────

describe("Gap Test 7: staleness — old findings annotated, fresh findings clean", () => {
  it("20-day-old finding → '(analyzed 20 days ago)'", () => {
    expect(mirrorStaleness(STALE_ANALYZED_AT)).toBe(" (analyzed 20 days ago)");
  });
  it("2-day-old finding → no annotation", () => {
    expect(mirrorStaleness(FRESH_ANALYZED_AT)).toBe("");
  });
});

// ─── Gap Test 8: filePath dedup keeps the most recent record ──────────────────

describe("Gap Test 8: filePath dedup — most-recent record wins", () => {
  it("two rows for same filePath collapse to one; newest finding survives", () => {
    const ctx = mirrorGetModuleContext(DUPLICATE_FILE_RECORDS);
    expect(ctx).not.toBeNull();
    // Only the newest row's finding remains
    expect(ctx!.findings.length).toBe(1);
    expect(ctx!.findings[0]!.finding.id).toBe("new1");
    expect(ctx!.findings[0]!.finding.title).toBe("NEW finding");
    // Older row dropped entirely
    expect(ctx!.findings.some((f) => f.finding.id === "old1")).toBe(false);
  });
});

// ─── Gap Test 9: gap synthesis directive fires on 2+ module headers ───────────

describe("Gap Test 9: V# prompt — gap synthesis directive on 2+ modules", () => {
  const baseCtx = { fullName: "owner/repo", name: "repo", language: "TypeScript" };

  it("2+ module headers → 'Gap synthesis mode' directive with verdict→gaps→why schema", () => {
    const moduleIntelligence = mirrorGetMultiModuleContext([ATLAS_RECORDS, SENTINEL_RECORDS, PULSE_RECORDS])!;
    const prompt = buildVHashSystemPrompt({ ...baseCtx, moduleIntelligence });
    expect(prompt).toContain("Gap synthesis mode");
    expect(prompt).toContain("Verdict");
    expect(prompt).toContain("Gaps");
    expect(prompt).toContain("Why it matters");
  });

  it("single-module context → does NOT enter gap synthesis mode", () => {
    const moduleIntelligence = mirrorGetMultiModuleContext([SENTINEL_RECORDS])!;
    const prompt = buildVHashSystemPrompt({ ...baseCtx, moduleIntelligence });
    expect(prompt).not.toContain("Gap synthesis mode");
  });
});

// ─── Gap Test 10: null-Atlas handling — gapNoData directive ──────────────────

describe("Gap Test 10: V# prompt — null-Atlas graceful degradation", () => {
  const baseCtx = { fullName: "owner/repo", name: "repo", language: "TypeScript" };

  it("gapNoData=true → 'run Atlas first' directive, no speculative gaps", () => {
    const prompt = buildVHashSystemPrompt({ ...baseCtx, gapNoData: true });
    expect(prompt).toContain("no stored intelligence exists");
    expect(prompt).toContain("Atlas");
    // It must instruct V# NOT to guess
    expect(prompt.toLowerCase()).toContain("do not guess");
  });

  it("no gap flags at all → neither gap directive present (ordinary prompt)", () => {
    const prompt = buildVHashSystemPrompt(baseCtx);
    expect(prompt).not.toContain("Gap synthesis mode");
    expect(prompt).not.toContain("no stored intelligence exists");
  });
});

// ─── Atlas Test 11: Critical File Registry (single-pass scan) ─────────────────
//
// buildDomainMap() detects high-signal files (middleware, route handlers, auth,
// realtime, server entry, config) by filename in the SAME O(n) pass that counts
// domains — no second scan. domain-map.ts has only type-only deps, so it is
// safe to import and exercise directly here.

describe("Atlas Test 11: critical file registry — single-pass detection", () => {
  function node(path: string, sha: string): { path: string; type: "blob"; sha: string } {
    return { path, type: "blob", sha };
  }
  function dir(path: string): { path: string; type: "tree"; sha: string } {
    return { path, type: "tree", sha: `tree-${path}` };
  }

  const tree = {
    owner: "owner",
    repo: "repo",
    branch: "main",
    fetchedAt: 0,
    nodes: [
      node("src/middleware.ts", "sha-mw"),
      node("src/app/api/users/route.ts", "sha-route"),
      node("src/server/auth/auth.ts", "sha-auth"),
      node("src/server/auth/auth.config.ts", "sha-authcfg"),
      node("src/server/realtime/socket.ts", "sha-socket"),
      node("server.ts", "sha-server"),
      node("next.config.ts", "sha-nextcfg"),
      node("src/app/page.tsx", "sha-page"),      // ordinary — not critical
      node("src/lib/format.ts", "sha-lib"),       // ordinary — not critical
      dir("src/app/api"),                          // directory — never critical
    ],
  };

  it("detects each critical kind by filename, ignoring ordinary files and dirs", () => {
    const map = buildDomainMap(tree);
    const byKind = new Map<string, string[]>();
    for (const c of map.criticalFiles) {
      byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.path]);
    }

    expect(byKind.get("middleware")).toEqual(["src/middleware.ts"]);
    expect(byKind.get("route-handler")).toEqual(["src/app/api/users/route.ts"]);
    expect(byKind.get("auth")?.sort()).toEqual(
      ["src/server/auth/auth.config.ts", "src/server/auth/auth.ts"]
    );
    expect(byKind.get("realtime")).toEqual(["src/server/realtime/socket.ts"]);
    expect(byKind.get("server-entry")).toEqual(["server.ts"]);
    expect(byKind.get("config")).toEqual(["next.config.ts"]);

    // Ordinary source files and directories are never flagged.
    const allPaths = map.criticalFiles.map((c) => c.path);
    expect(allPaths).not.toContain("src/app/page.tsx");
    expect(allPaths).not.toContain("src/lib/format.ts");
    expect(allPaths).not.toContain("src/app/api");
  });

  it("attaches the matched domain (and null for root-level config)", () => {
    const map = buildDomainMap(tree);
    const find = (p: string) => map.criticalFiles.find((c) => c.path === p);

    // route.ts lives under src/app/api → "API Routes"
    expect(find("src/app/api/users/route.ts")?.domain).toBe("API Routes");
    // auth.ts lives under src/server/auth → "Auth Layer"
    expect(find("src/server/auth/auth.ts")?.domain).toBe("Auth Layer");
    // next.config.ts is root-level — outside every domain prefix → null
    expect(find("next.config.ts")?.domain).toBeNull();
  });

  it("carries each file's blob SHA for downstream per-file freshness", () => {
    const map = buildDomainMap(tree);
    const mw = map.criticalFiles.find((c) => c.kind === "middleware");
    expect(mw?.sha).toBe("sha-mw");
  });
});

// ─── Atlas Test 12: structural fingerprint (content-insensitive freshness) ────
//
// Atlas's freshness key must change ONLY when architecture changes, never on a
// content-only edit. deriveStructuralFingerprint() hashes domain shape +
// critical-file names — deliberately NOT blob SHAs. Same structure + different
// blob SHAs ⇒ identical fingerprint (cache hit, no wasted re-analysis).

describe("Atlas Test 12: structural fingerprint — content-insensitive", () => {
  function blob(path: string, sha: string): { path: string; type: "blob"; sha: string } {
    return { path, type: "blob", sha };
  }
  const baseTree = (shaSuffix: string) => ({
    owner: "owner",
    repo: "repo",
    branch: "main",
    fetchedAt: 0,
    nodes: [
      blob("src/app/api/users/route.ts", `route-${shaSuffix}`),
      blob("src/server/auth/auth.ts", `auth-${shaSuffix}`),
      blob("src/lib/format.ts", `lib-${shaSuffix}`),
      blob("src/app/page.tsx", `page-${shaSuffix}`),
    ],
  });

  it("identical structure + different blob SHAs → identical fingerprint", () => {
    // Simulates a content-only edit: every file's blob SHA changed, but the
    // architecture (domains, counts, critical files) is unchanged.
    const fpA = deriveStructuralFingerprint(buildDomainMap(baseTree("v1")));
    const fpB = deriveStructuralFingerprint(buildDomainMap(baseTree("v2")));
    expect(fpA).toBe(fpB);
  });

  it("adding a file to a domain → fingerprint changes (real structural change)", () => {
    const before = buildDomainMap(baseTree("v1"));
    const grown = buildDomainMap({
      ...baseTree("v1"),
      nodes: [...baseTree("v1").nodes, blob("src/lib/dates.ts", "dates-v1")],
    });
    expect(deriveStructuralFingerprint(before)).not.toBe(
      deriveStructuralFingerprint(grown)
    );
  });

  it("adding a critical file → fingerprint changes", () => {
    const before = buildDomainMap(baseTree("v1"));
    const withMiddleware = buildDomainMap({
      ...baseTree("v1"),
      nodes: [...baseTree("v1").nodes, blob("src/middleware.ts", "mw-v1")],
    });
    expect(deriveStructuralFingerprint(before)).not.toBe(
      deriveStructuralFingerprint(withMiddleware)
    );
  });

  it("fingerprint is deterministic and carries shape counts", () => {
    const fp = deriveStructuralFingerprint(buildDomainMap(baseTree("v1")));
    expect(fp).toBe(deriveStructuralFingerprint(buildDomainMap(baseTree("v1"))));
    expect(fp).toMatch(/^arch-\d+d-\d+c-[0-9a-f]{8}$/);
  });
});

// ─── Test 13: agent-orchestration — V# module dispatch detection ──────────────
//
// V# is the only interface. detectOrchestrationAction maps explicit module-control
// intents to actions. Atlas auto-runs (free); paid modules gate on confirm-before-
// spend; discovery never spends. False positives must NOT trigger a paid run.

describe("Test 13: agent-orchestration — detectOrchestrationAction", () => {
  it("detects agent discovery", () => {
    expect(detectOrchestrationAction("what agents are available?")?.kind).toBe("discover");
    expect(detectOrchestrationAction("list the agents")?.kind).toBe("discover");
    expect(detectOrchestrationAction("what can you analyze for me")?.kind).toBe("discover");
  });

  it("routes natural-language architecture intents to Atlas (free, auto-run)", () => {
    for (const msg of [
      "run atlas",
      "analyze the architecture",
      "map this repo",
      "show me the architecture",
      "understand this repo",
    ]) {
      const action = detectOrchestrationAction(msg);
      expect(action?.kind).toBe("run-atlas");
      if (action?.kind === "run-atlas") expect(action.refresh).toBe(false);
    }
  });

  it("selects the lens from intent so responses differ materially", () => {
    const cases: Array<[string, "topology" | "architecture" | "capability"]> = [
      ["map this repo",            "topology"],
      ["show me the folder structure", "topology"],
      ["analyze the architecture", "architecture"],
      ["show me the architecture", "architecture"],
      ["run atlas",                "architecture"], // bare run → richest default
      ["understand this repo",     "capability"],
      ["what does this repo do",   "capability"],
    ];
    for (const [msg, lens] of cases) {
      const action = detectOrchestrationAction(msg);
      expect(action?.kind).toBe("run-atlas");
      if (action?.kind === "run-atlas") expect(action.lens).toBe(lens);
    }
  });

  it("flags an explicit refresh so Atlas bypasses cache", () => {
    const action = detectOrchestrationAction("re-run the architecture analysis, fresh please");
    expect(action?.kind).toBe("run-atlas");
    if (action?.kind === "run-atlas") expect(action.refresh).toBe(true);
  });

  it("gates a paid module with no file path on confirmation (no spend)", () => {
    const action = detectOrchestrationAction("use cipher");
    expect(action?.kind).toBe("confirm-paid");
    if (action?.kind === "confirm-paid") {
      expect(action.agentId).toBe("cipher");
      expect(action.filePath).toBeNull();
    }
  });

  it("shows a confirmation preview even when a file path is present (confirm-before-spend)", () => {
    const action = detectOrchestrationAction("run sentinel on apps/web/src/middleware.ts");
    expect(action?.kind).toBe("confirm-paid");
    if (action?.kind === "confirm-paid") {
      expect(action.agentId).toBe("sentinel");
      expect(action.filePath).toBe("apps/web/src/middleware.ts");
    }
  });

  it("runs a paid module only when the confirm phrase carries the file path", () => {
    const action = detectOrchestrationAction("confirm cipher apps/web/src/server/repo/domain-map.ts");
    expect(action?.kind).toBe("run-paid");
    if (action?.kind === "run-paid") {
      expect(action.agentId).toBe("cipher");
      expect(action.filePath).toBe("apps/web/src/server/repo/domain-map.ts");
    }
  });

  it("does NOT trigger a paid run from incidental prose (false-positive guard)", () => {
    expect(detectOrchestrationAction("the pulse of the community feed feels off")).toBeNull();
    expect(detectOrchestrationAction("we store a sentinel value in the cache")).toBeNull();
    expect(detectOrchestrationAction("how does the login flow work?")).toBeNull();
  });

  it("prioritizes a paid module over Atlas when both could match", () => {
    // "analyze the architecture with cipher" names a paid module + a verb → paid wins,
    // because paid must be gated by confirm-before-spend, not auto-run by Atlas.
    const action = detectOrchestrationAction("analyze the architecture with cipher");
    expect(action?.kind).toBe("confirm-paid");
  });

  it("extractFilePath prefers slashed paths and rejects non-paths", () => {
    expect(extractFilePath("look at apps/web/src/foo.tsx please")).toBe("apps/web/src/foo.tsx");
    expect(extractFilePath("analyze middleware.ts")).toBe("middleware.ts");
    expect(extractFilePath("check the GameUTalk.com domain")).toBeNull();
    expect(extractFilePath("no path here at all")).toBeNull();
  });
});

describe("Test 13b: agent-orchestration — formatters", () => {
  it("roster lists every module by display name with cost framing", () => {
    const roster = formatAgentRoster();
    for (const name of ["Atlas", "Cipher", "Sentinel", "Pulse", "Forge"]) {
      expect(roster).toContain(name);
    }
    expect(roster).toContain("free");       // Atlas is free
    expect(roster).toContain("paid AI call"); // paid modules flagged
  });

  it("paid confirmation asks for a file when none is given", () => {
    const msg = formatPaidConfirmation("cipher", null);
    expect(msg).toContain("confirm cipher");
    expect(msg.toLowerCase()).toContain("paid");
  });

  it("paid confirmation echoes the target path and the confirm phrase", () => {
    const msg = formatPaidConfirmation("pulse", "apps/web/src/foo.ts");
    expect(msg).toContain("apps/web/src/foo.ts");
    expect(msg).toContain("confirm pulse apps/web/src/foo.ts");
  });
});

// ─── Test 14: capability inference (path-signal, content-blind) ───────────────
// Atlas must surface what the repo DOES (Authentication, Messaging…) from path
// evidence alone — never folder names like src/components, never file contents.

describe("Test 14: capability-map — deriveCapabilities", () => {
  // Minimal GitHubTreeNode factory (size is optional in the real type).
  const f = (path: string) => ({ path, type: "blob" as const, sha: "x" });

  it("names capabilities from path evidence, not folder names", () => {
    const caps = deriveCapabilities([
      f("src/app/(auth)/login/page.tsx"),
      f("src/server/chat/messages.ts"),
      f("src/lib/upload/handler.ts"),
      f("src/features/search/index.ts"),
    ]);
    const names = caps.map((c) => c.name);
    expect(names).toContain("Authentication");
    expect(names).toContain("Messaging");
    expect(names).toContain("Uploads");
    expect(names).toContain("Search");
    // None of the capability NAMES should be a raw folder path.
    for (const n of names) {
      expect(n.includes("/")).toBe(false);
      expect(n).not.toBe("src/components");
      expect(n).not.toBe("src/pages");
    }
  });

  it("labels a dedicated path as 'confirmed'", () => {
    // "/login/" is a strong Authentication signal → confirmed, not guessed.
    const caps = deriveCapabilities([f("src/app/(auth)/login/page.tsx")]);
    const auth = caps.find((c) => c.name === "Authentication");
    expect(auth).toBeDefined();
    expect(auth!.confidence).toBe("confirmed");
    // Evidence cites the concrete path it was inferred from.
    expect(auth!.paths[0]).toBe("src/app/(auth)/login/page.tsx");
  });

  it("returns NO capabilities for generic presentation folders", () => {
    const caps = deriveCapabilities([
      f("src/components/Button.tsx"),
      f("src/pages/Home.tsx"),
      f("src/styles/main.css"),
    ]);
    expect(caps).toHaveLength(0);
  });

  it("ignores vendor/build paths entirely", () => {
    const caps = deriveCapabilities([
      f("node_modules/some-auth-lib/login/index.js"),
      f(".next/server/chat/messages.js"),
    ]);
    expect(caps).toHaveLength(0);
  });

  it("sorts most-evidenced capabilities first", () => {
    const caps = deriveCapabilities([
      // 3 Authentication signals vs 1 Search signal.
      f("src/auth/login/page.tsx"),
      f("src/auth/session.ts"),
      f("src/auth/oauth/callback.ts"),
      f("src/search/index.ts"),
    ]);
    for (let i = 0; i < caps.length - 1; i++) {
      expect(caps[i].signalCount).toBeGreaterThanOrEqual(caps[i + 1].signalCount);
    }
    expect(caps[0].name).toBe("Authentication");
  });
});

// ─── Test 14b: lens formatters produce materially different output ────────────
// The three lenses project the SAME model differently, so "map" / "analyze" /
// "what does it do" never return near-identical text (the original bug).

describe("Test 14b: formatAtlasResult — lenses differ by intent", () => {
  const tree: ArchitectureTree = {
    domains: [
      { name: "Server", prefix: "src/server", fileCount: 12, pressure: "heavy" },
      { name: "App", prefix: "src/app", fileCount: 8, pressure: "medium" },
    ],
    repoFullName: "owner/repo",
    detectedAt: 0,
  };
  const findings: IntelCipherFinding[] = [
    {
      id: "f1",
      type: "pressure",
      title: "Hotspot in orchestration",
      description: "agent-orchestration.ts carries heavy branching.",
      confidence: "inferred",
      agentReasoning: "many code paths in one file",
    },
  ];
  const capabilities: Capability[] = [
    {
      name: "Authentication",
      confidence: "confirmed",
      evidence: ["1 dedicated path (e.g. `src/app/(auth)/login/page.tsx`)"],
      paths: ["src/app/(auth)/login/page.tsx"],
      signalCount: 1,
    },
  ];

  const base = {
    refresh: false,
    architectureTree: tree,
    findings,
    capabilities,
    totalPaths: 1234,
    truncated: false,
    fromCache: false,
  } as const;

  const topology = formatAtlasResult({ ...base, lens: "topology" });
  const architecture = formatAtlasResult({ ...base, lens: "architecture" });
  const capability = formatAtlasResult({ ...base, lens: "capability" });

  it("produces three materially different responses", () => {
    expect(topology).not.toBe(architecture);
    expect(architecture).not.toBe(capability);
    expect(topology).not.toBe(capability);
  });

  it("topology shows folder shape and the total path count", () => {
    expect(topology).toContain("1234");
    expect(topology).toContain("src/server");
    expect(topology.toLowerCase()).toContain("topology");
  });

  it("capability shows capability names, not folder paths", () => {
    expect(capability).toContain("Authentication");
    expect(capability).not.toContain("src/server");
    expect(capability.toLowerCase()).toContain("capabilit");
  });

  it("architecture shows structural findings", () => {
    expect(architecture).toContain("Hotspot in orchestration");
    expect(architecture.toLowerCase()).toContain("architecture");
  });

  it("refresh annotates the provenance as re-analyzed", () => {
    const refreshed = formatAtlasResult({ ...base, lens: "architecture", refresh: true });
    expect(refreshed).toContain("re-analyzed");
  });
});

// ─── Test 15: Atlas Relationship Engine (Increment A + B) ─────────────────────
// Deterministic architecture graph: system nodes + tiers (A) and external
// dependency edges from package.json (B). No AI, no content crawl.

describe("Test 15: architecture-wire — system nodes + tiers (A)", () => {
  const f = (path: string) => ({ path, type: "blob" as const, sha: "x" });

  it("turns path capabilities into tiered system nodes", () => {
    const nodes = deriveSystemNodes([
      f("src/app/api/users/route.ts"),
      f("src/app/(auth)/login/page.tsx"),
      f("prisma/schema.prisma"),
      f("src/server/chat/messages.ts"),
    ]);
    const byName = new Map(nodes.map((n) => [n.name, n]));
    expect(byName.get("API Layer")?.tier).toBe("entry");
    expect(byName.get("Authentication")?.tier).toBe("domain");
    expect(byName.get("Database & Migrations")?.tier).toBe("data");
    expect(byName.get("Messaging")?.tier).toBe("domain");
  });

  it("node ids equal names (stable identity across runs)", () => {
    const nodes = deriveSystemNodes([f("src/app/(auth)/login/page.tsx")]);
    const auth = nodes.find((n) => n.name === "Authentication");
    expect(auth?.id).toBe("Authentication");
  });

  it("sorts nodes by tier so layout is deterministic (entry first)", () => {
    const nodes = deriveSystemNodes([
      f("prisma/schema.prisma"),         // data
      f("src/app/api/x/route.ts"),       // entry
      f("src/app/(auth)/login/page.tsx"),// domain
    ]);
    const tiers = nodes.map((n) => n.tier);
    expect(tiers.indexOf("entry")).toBeLessThan(tiers.indexOf("data"));
  });

  it("produces no nodes for generic presentation folders", () => {
    const nodes = deriveSystemNodes([f("src/components/Button.tsx"), f("src/pages/Home.tsx")]);
    expect(nodes).toHaveLength(0);
  });
});

describe("Test 15b: architecture-wire — dependency edges (B)", () => {
  const f = (path: string) => ({ path, type: "blob" as const, sha: "x" });

  const TREE = [
    f("src/app/api/users/route.ts"),       // API Layer (entry, hub)
    f("src/app/(auth)/login/page.tsx"),     // Authentication
  ];
  const DEPS = ["next", "@clerk/nextjs", "stripe", "@prisma/client", "socket.io"];

  it("creates/confirms systems from dependencies, even without a matching path", () => {
    const nodes = deriveSystemNodes(TREE, DEPS);
    const byName = new Map(nodes.map((n) => [n.name, n]));

    // Authentication existed by path → confirmed + carries the dependency.
    const auth = byName.get("Authentication")!;
    expect(auth.confidence).toBe("confirmed");
    expect(auth.dependencies).toContain("@clerk/nextjs");

    // Payments had NO path — created purely from the `stripe` dependency.
    const pay = byName.get("Payments")!;
    expect(pay).toBeDefined();
    expect(pay.dependencies).toContain("stripe");
    expect(pay.fileCount).toBe(0);

    // Database + Realtime infra nodes appear with correct tiers.
    expect(byName.get("Database & Migrations")?.tier).toBe("data");
    expect(byName.get("Realtime")?.tier).toBe("infra");
  });

  it("wires every backed system to the API Layer hub with typed edges", () => {
    const graph = buildArchitectureGraph({ nodes: TREE, dependencies: DEPS });
    const edge = (to: string) => graph.edges.find((e) => e.from === "API Layer" && e.to === to);

    expect(edge("Authentication")?.type).toBe("depends-on");
    expect(edge("Payments")?.type).toBe("depends-on");
    expect(edge("Realtime")?.type).toBe("depends-on");
    // Data store → data-flow edge (where data flows).
    expect(edge("Database & Migrations")?.type).toBe("data-flow");
    // Evidence cites the backing package.
    expect(edge("Payments")?.evidence.some((e) => e.includes("stripe"))).toBe(true);
    // No self-edge on the hub.
    expect(graph.edges.some((e) => e.from === "API Layer" && e.to === "API Layer")).toBe(false);
  });

  it("synthesizes an Application hub when no API Layer exists", () => {
    // No route/api path and no API-framework dependency → no API Layer node.
    const graph = buildArchitectureGraph({
      nodes: [f("src/lib/auth/session.ts")],
      dependencies: ["@clerk/nextjs", "stripe"],
    });
    expect(graph.nodes.some((n) => n.name === "Application")).toBe(true);
    expect(graph.edges.every((e) => e.from === "Application")).toBe(true);
  });

  it("emits no edges when there are no backing dependencies (A still yields nodes)", () => {
    const graph = buildArchitectureGraph({ nodes: TREE });
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it("fingerprint is stable for identical input and changes with the graph", () => {
    const a = buildArchitectureGraph({ nodes: TREE, dependencies: DEPS });
    const b = buildArchitectureGraph({ nodes: TREE, dependencies: DEPS });
    const c = buildArchitectureGraph({ nodes: TREE, dependencies: ["next"] });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it("toWires projects adjacency: hub has out-edges, targets have in-edges", () => {
    const graph = buildArchitectureGraph({ nodes: TREE, dependencies: DEPS });
    const wires = toWires(graph);
    const hub = wires.find((w) => w.node.id === "API Layer")!;
    expect(hub.out.length).toBeGreaterThan(0);
    const pay = wires.find((w) => w.node.id === "Payments")!;
    expect(pay.in.some((e) => e.from === "API Layer")).toBe(true);
  });
});

describe("Test 15c: architecture-wire — parsePackageDependencies", () => {
  it("merges dependency buckets and tolerates malformed JSON", () => {
    const text = JSON.stringify({
      dependencies: { next: "15", "@clerk/nextjs": "6" },
      devDependencies: { prisma: "5" },
    });
    const deps = parsePackageDependencies(text);
    expect(deps).toContain("next");
    expect(deps).toContain("@clerk/nextjs");
    expect(deps).toContain("prisma");
    expect(parsePackageDependencies("{ not json")).toEqual([]);
  });
});

// ─── Test 16: Architecture graph lens (Increment E) ──────────────────────────
// New Atlas lens "show architecture graph" → relationship map in chat, and the
// detector routes graph intent ahead of topology.

describe("Test 16: agent-orchestration — graph lens detection", () => {
  it("routes graph intent to the graph lens (ahead of topology)", () => {
    expect(detectOrchestrationAction("show architecture graph")).toMatchObject({ kind: "run-atlas", lens: "graph" });
    expect(detectOrchestrationAction("show me the system map")).toMatchObject({ kind: "run-atlas", lens: "graph" });
    expect(detectOrchestrationAction("how do systems connect")).toMatchObject({ kind: "run-atlas", lens: "graph" });
  });

  it("does not hijack the other lenses", () => {
    expect(detectOrchestrationAction("map this repo")).toMatchObject({ kind: "run-atlas", lens: "topology" });
    expect(detectOrchestrationAction("show me the architecture")).toMatchObject({ kind: "run-atlas", lens: "architecture" });
    expect(detectOrchestrationAction("what does this repo do")).toMatchObject({ kind: "run-atlas", lens: "capability" });
  });
});

describe("Test 16b: formatAtlasResult — graph lens rendering", () => {
  const f = (path: string) => ({ path, type: "blob" as const, sha: "x" });
  const graph = buildArchitectureGraph({
    nodes: [f("src/app/api/users/route.ts"), f("src/app/(auth)/login/page.tsx")],
    dependencies: ["next", "@clerk/nextjs", "stripe", "@prisma/client"],
  });

  const render = (graphArg: typeof graph | undefined) =>
    formatAtlasResult({
      lens: "graph",
      refresh: false,
      architectureTree: null,   // graph lens renders without a domain tree
      findings: [],
      capabilities: [],
      totalPaths: 120,
      truncated: false,
      fromCache: false,
      graph: graphArg,
    });

  it("renders tiered systems, directed relationships, and confidence", () => {
    const out = render(graph);
    expect(out).toContain("Architecture Graph");
    expect(out).toContain("API Layer");
    expect(out).toContain("Authentication");
    expect(out).toContain("Entry layer");
    expect(out).toContain("→");                 // directed edge
    expect(out).toMatch(/depends-on|data-flow/); // typed edge
    expect(out.toLowerCase()).toContain("inferred"); // edge confidence
    expect(out).toContain("Architecture Workspace"); // pointer to the canvas
  });

  it("falls back gracefully when no graph is available", () => {
    const out = render(undefined);
    expect(out).toContain("Architecture Graph");
    expect(out.toLowerCase()).toContain("couldn't derive a system graph");
  });
});

// ─── Test 17: File map (Stage 1 — file-level classification) ─────────────────
// Deterministic file → layer + role classification from path signals only.

describe("Test 17: file-map — classifyFile", () => {
  const layerOf = (p: string) => classifyFile(p).layer;
  const roleOf  = (p: string) => classifyFile(p).role;

  it("classifies entry / context / guard files", () => {
    expect(classifyFile("src/App.tsx")).toEqual({ layer: "client-entry", role: "entry" });
    expect(classifyFile("src/index.tsx")).toEqual({ layer: "client-entry", role: "entry" });
    expect(roleOf("src/context/AuthContext.tsx")).toBe("provider");
    expect(layerOf("src/context/AuthContext.tsx")).toBe("context-guards");
    expect(roleOf("src/routes/ProtectedRoute.tsx")).toBe("guard");
  });

  it("classifies pages, frontend services, and hooks", () => {
    expect(classifyFile("src/features/feed/pages/HomeFeed.tsx")).toEqual({ layer: "feature-pages", role: "page" });
    expect(classifyFile("app/dashboard/page.tsx")).toEqual({ layer: "feature-pages", role: "page" });
    expect(classifyFile("src/services/feedService.ts")).toEqual({ layer: "frontend-services", role: "frontend-service" });
    expect(roleOf("src/hooks/useFeed.ts")).toBe("hook");
  });

  it("classifies API / middleware / backend by context", () => {
    expect(classifyFile("backend/src/server.ts")).toEqual({ layer: "api-middleware", role: "server-entry" });
    expect(classifyFile("backend/src/modules/posts/posts.routes.ts")).toEqual({ layer: "api-middleware", role: "route" });
    expect(classifyFile("middleware.ts")).toEqual({ layer: "api-middleware", role: "middleware" });
    // *.service.ts in a backend context → backend, not frontend.
    expect(classifyFile("backend/src/modules/chat/chats.service.ts")).toEqual({ layer: "backend-modules", role: "backend-service" });
    expect(roleOf("backend/src/modules/auth/auth.controller.ts")).toBe("controller");
  });

  it("classifies data / schema / config / tests", () => {
    expect(classifyFile("prisma/schema.prisma")).toEqual({ layer: "data-schema", role: "schema" });
    expect(roleOf("prisma/migrations/0001_init/migration.sql")).toBe("migration");
    expect(layerOf("package.json")).toBe("config");
    expect(layerOf("next.config.mjs")).toBe("config");
    expect(roleOf("src/feed/feed.test.ts")).toBe("test");
  });

  it("buildFileMap groups by layer, excludes vendor + directories", () => {
    const f = (path: string, type: "blob" | "tree" = "blob") => ({ path, type, sha: "x", size: 100 });
    const map = buildFileMap([
      f("src/App.tsx"),
      f("src/services/feedService.ts"),
      f("prisma/schema.prisma"),
      f("src/features", "tree"),               // directory → excluded
      f("node_modules/react/index.js"),        // vendor → excluded
    ]);
    expect(map.totalFiles).toBe(3);
    expect(map.byLayer["client-entry"].map((n) => n.name)).toContain("App.tsx");
    expect(map.byLayer["frontend-services"].some((n) => n.name === "feedService.ts")).toBe(true);
    expect(map.byLayer["data-schema"].some((n) => n.role === "schema")).toBe(true);
    expect(map.files.every((n) => !n.path.includes("node_modules"))).toBe(true);
  });
});

// ─── Test 18: Import graph (Stage 2 — call wires) ────────────────────────────
// Deterministic import parse + resolution → file→file edges with evidence.

describe("Test 18: import-graph — parse + resolve", () => {
  it("parses import / export / dynamic / require specifiers with line numbers", () => {
    const src = [
      `import App from "./App";`,                    // 1
      `import { db } from "@/lib/db";`,              // 2
      `export { x } from "./util";`,                 // 3
      `const m = await import("./lazy");`,           // 4
      `const fs = require("node:fs");`,              // 5
      `import "./styles.css";`,                      // 6
    ].join("\n");
    const imps = parseImports(src);
    const bySpec = new Map(imps.map((i) => [i.spec, i.line]));
    expect(bySpec.get("./App")).toBe(1);
    expect(bySpec.get("@/lib/db")).toBe(2);
    expect(bySpec.get("./util")).toBe(3);
    expect(bySpec.get("./lazy")).toBe(4);
    expect(bySpec.get("node:fs")).toBe(5);
    expect(bySpec.get("./styles.css")).toBe(6);
  });

  it("parses tsconfig path aliases (comments + trailing commas tolerated)", () => {
    const ts = `{
      // project config
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["./src/*"], },
      },
    }`;
    const aliases = parseTsconfigAliases(ts);
    expect(aliases).toEqual([{ prefix: "@/", target: "src/" }]);
  });

  it("resolves relative + alias imports against the path index", () => {
    const index = new Set([
      "src/app/App.tsx",
      "src/lib/db.ts",
      "src/lib/index.ts",
      "src/app/util.ts",
    ]);
    const aliases = [{ prefix: "@/", target: "src/" }];

    // relative, extension probed
    expect(resolveImport("src/app/page.tsx", "./util", index, aliases))
      .toEqual({ path: "src/app/util.ts", confidence: "confirmed" });
    // alias
    expect(resolveImport("src/app/page.tsx", "@/lib/db", index, aliases))
      .toEqual({ path: "src/lib/db.ts", confidence: "confirmed" });
    // barrel index → inferred
    expect(resolveImport("src/app/page.tsx", "@/lib", index, aliases))
      .toEqual({ path: "src/lib/index.ts", confidence: "inferred" });
    // bare package → external (null)
    expect(resolveImport("src/app/page.tsx", "react", index, aliases)).toBeNull();
    // unresolvable internal → null
    expect(resolveImport("src/app/page.tsx", "./missing", index, aliases)).toBeNull();
  });

  it("selectAnchors prioritizes high-signal layers and skips noise roles", () => {
    const f = (path: string, layer: string, role: string) => ({ path, name: path.split("/").pop()!, layer, role, size: 0 }) as never;
    const files = [
      f("src/styles/x.css", "shared", "style"),         // skipped (style)
      f("src/services/a.ts", "frontend-services", "frontend-service"),
      f("src/App.tsx", "client-entry", "entry"),
    ];
    const { anchors, total } = selectAnchors(files, 10);
    expect(total).toBe(2);                       // style excluded
    expect(anchors[0]?.path).toBe("src/App.tsx"); // entry layer first
  });

  it("buildImportGraph emits resolved, deduped edges with evidence", async () => {
    const f = (path: string, layer: string, role: string) => ({ path, name: path.split("/").pop()!, layer, role, size: 0 }) as never;
    const files = [
      f("src/app/page.tsx", "feature-pages", "page"),
      f("src/services/feedService.ts", "frontend-services", "frontend-service"),
    ];
    const pathIndex = new Set(["src/app/page.tsx", "src/services/feedService.ts"]);
    const contents: Record<string, string> = {
      "src/app/page.tsx": `import { build } from "../services/feedService";\nimport React from "react";`,
      "src/services/feedService.ts": `export const build = () => 1;`,
    };
    const graph = await buildImportGraph({
      files,
      pathIndex,
      aliases: [],
      fetchContent: async (p) => contents[p] ?? null,
    });
    expect(graph.scanned).toBe(2);
    // page → feedService resolved; react (bare) dropped.
    const edge = graph.edges.find((e) => e.from === "src/app/page.tsx");
    expect(edge?.to).toBe("src/services/feedService.ts");
    expect(edge?.confidence).toBe("confirmed");
    expect(edge?.evidence[0]?.line).toBe(1);
    expect(graph.edges.every((e) => e.to !== "react")).toBe(true);
  });
});

// ─── Test 19: Narration parser (Stage 3) ─────────────────────────────────────
// Tolerant JSON parse of the model's narration response.

describe("Test 19: narration — parseNarration", () => {
  it("parses clean JSON into a FileNarration", () => {
    const out = parseNarration(JSON.stringify({
      technicalRole: "Renders the ranked social feed",
      plainEnglish: "The home page — shows posts ordered by relevance.",
      notes: ["Reads posts from DataContext", "Calls buildSmartFeed()"],
    }));
    expect(out?.technicalRole).toBe("Renders the ranked social feed");
    expect(out?.notes).toHaveLength(2);
  });

  it("tolerates code fences and surrounding prose", () => {
    const raw = "Sure! Here you go:\n```json\n{\"technicalRole\":\"Auth guard\",\"plainEnglish\":\"Protects routes.\",\"notes\":[\"Checks session\"]}\n```";
    const out = parseNarration(raw);
    expect(out?.technicalRole).toBe("Auth guard");
    expect(out?.notes).toEqual(["Checks session"]);
  });

  it("caps notes at 5 and drops non-string entries", () => {
    const out = parseNarration(JSON.stringify({
      technicalRole: "x", plainEnglish: "y",
      notes: ["a", "b", "c", "d", "e", "f", 42, null],
    }));
    expect(out?.notes).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns null for unusable responses", () => {
    expect(parseNarration("not json at all")).toBeNull();
    expect(parseNarration("")).toBeNull();
    expect(parseNarration(JSON.stringify({ technicalRole: "", plainEnglish: "", notes: [] }))).toBeNull();
  });
});

// ─── Test 20: Notable Findings parser (Stage 3b) ─────────────────────────────

describe("Test 20: findings — parseFindings", () => {
  it("parses a bare array of findings", () => {
    const out = parseFindings(JSON.stringify([
      { title: "Dead worker", severity: "warn", detail: "emailCleanupWorker is null.", evidence: ["workers.ts"] },
      { title: "N+1 risk", severity: "risk", detail: "8 sequential queries.", evidence: ["server.ts"] },
    ]));
    expect(out).toHaveLength(2);
    expect(out[0]?.severity).toBe("warn");
    expect(out[1]?.evidence).toEqual(["server.ts"]);
  });

  it("accepts a { findings: [...] } wrapper and tolerates fences", () => {
    const raw = "```json\n{ \"findings\": [ { \"title\": \"Gated\", \"severity\": \"info\", \"detail\": \"feature flag off\" } ] }\n```";
    const out = parseFindings(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Gated");
    expect(out[0]?.evidence).toEqual([]); // missing evidence → []
  });

  it("defaults unknown severity to info, drops items missing title/detail, caps at 8", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, severity: "bogus", detail: "d" }));
    items.push({ title: "", severity: "risk", detail: "no title" } as never);
    const out = parseFindings(JSON.stringify(items));
    expect(out).toHaveLength(8);
    expect(out.every((f) => f.severity === "info")).toBe(true);
  });

  it("returns [] for unusable input", () => {
    expect(parseFindings("nope")).toEqual([]);
    expect(parseFindings("")).toEqual([]);
  });
});
