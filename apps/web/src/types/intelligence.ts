/**
 * Persistent Repository Intelligence — shared type definitions.
 *
 * CipherFinding is stored as JSONB in the FileIntelligence table.
 * All AI-generated content is typed with explicit confidence fields
 * to prevent false certainty from reaching the UI.
 *
 * Evidence contract:
 *   - "confirmed"   — directly visible in the code (quoted line range)
 *   - "inferred"    — reasonable deduction from code structure
 *   - "speculative" — possible concern, needs more context to verify
 *
 * Cipher MUST always populate agentReasoning. UI surfaces this
 * so developers can verify or dispute findings.
 *
 * Multi-module architecture:
 *   AgentId discriminates between intelligence modules. Each module
 *   maintains its own FileIntelligence row per file (unique key includes agentId).
 *   Modules: cipher (code quality), sentinel (security), pulse (performance),
 *            atlas (architecture), forge (implementation planning).
 */

// ─── Module identity ──────────────────────────────────────────

/** Discriminant for all intelligence modules. Persisted in FileIntelligence.agentId. */
export type AgentId =
  | "cipher"    // code quality & structure
  | "atlas"     // repository architecture
  | "sentinel"  // security signals
  | "pulse"     // performance patterns
  | "forge";    // implementation planning

// ─── Module status ────────────────────────────────────────────

/** Terminal status of a module run. Carried in AgentResult.status. */
export type ModuleStatus =
  | "success"               // analysis completed, findings stored
  | "parse_error"           // AI returned unparseable output
  | "insufficient_evidence" // not enough context to produce findings (e.g. Forge with 0 inputs)
  | "provider_timeout"      // AI provider call timed out
  | "content_too_large";    // file exceeded context window

// ─── Finding type ─────────────────────────────────────────────

export type FindingType =
  | "implementation"   // how the feature is built
  | "integrity"        // potential correctness issues
  | "pressure"         // complexity / hotspot signals
  | "dependency"       // cross-file or cross-system coupling
  | "security-signal"; // observable security patterns (not vulnerability claims)

export type FindingConfidence =
  | "confirmed"    // directly readable from the code provided
  | "inferred"     // reasonable deduction — labelled as inference
  | "speculative"; // possible concern — needs more files to confirm

export interface CipherFinding {
  /** Stable ID for dedup — derived from (filePath + type + title). */
  id: string;

  type: FindingType;

  /** Short title shown in the UI (≤80 chars). */
  title: string;

  /** Full description. Must not claim certainty beyond what evidenceLines shows. */
  description: string;

  /** How confident the module is. Must appear in UI near every finding. */
  confidence: FindingConfidence;

  /**
   * Line range in the analyzed file where the finding is grounded.
   * Required for "confirmed" confidence. Optional for "inferred"/"speculative".
   */
  evidenceLines?: { start: number; end: number };

  /**
   * Other file paths that corroborate this finding.
   * Only reference files that were explicitly analyzed — do NOT invent paths.
   */
  relatedFilePaths?: string[];

  /** Pressure level — relevant for "pressure" type findings. */
  pressureLevel?: "high" | "medium" | "low";

  /**
   * What the module based this finding on — ALWAYS required.
   * Must be specific: quote the line, pattern, or structure observed.
   * Do not use generic phrases like "based on analysis".
   */
  agentReasoning: string;

  /**
   * Module-specific metadata for extensibility.
   * Sentinel uses: { cveRef?: string; owasp?: string }
   * Pulse uses: { complexity?: number; hotspot?: boolean }
   * Atlas uses: { domain?: string; layer?: string }
   */
  metadata?: Record<string, unknown>;
}

// ─── Architecture tree (Atlas output) ────────────────────────

/** Atlas's structural view of a repository — persisted in AgentResult. */
export interface ArchitectureTree {
  domains: Array<{
    name: string;
    prefix: string;
    fileCount: number;
    pressure: "heavy" | "medium" | "light";
  }>;
  repoFullName: string;
  detectedAt: number;
}

// ─── Agent result base ────────────────────────────────────────

/**
 * Fields shared by every module result.
 * AgentResult extends this contract with file-specific fields.
 */
export interface AgentResultBase {
  agentId:      AgentId;
  status:       ModuleStatus;
  timestamp:    string;
  repoFullName: string;
}

// ─── Agent result ─────────────────────────────────────────────

/** Full result envelope returned by any intelligence module. */
export interface AgentResult {
  agentId:      AgentId;
  repoFullName: string;
  filePath:     string;
  /** GitHub blob SHA of the analyzed file. */
  blobSHA:      string;
  findings:     CipherFinding[];
  /** ISO timestamp of when analysis was persisted. Null = dry-run / persist failed. */
  persistedAt:  string | null;
  /** Architecture node IDs this file's findings are attached to. */
  nodeAttachments: string[];
  /** True if an existing record was updated (same filePath+branch+agentId). False if new record. */
  wasDeduped:   boolean;
}

// ─── Module contract ──────────────────────────────────────────

/** Shared input contract for file-level intelligence modules. */
export interface ModuleInput {
  owner:       string;
  repo:        string;
  filePath:    string;
  branch:      string;
  githubToken: string;
  aiConfig: {
    provider: "anthropic" | "openai" | "openrouter" | "gemini";
    apiKey:   string;
    model?:   string;
  };
  /** If true, skip AI call and only return cached findings (if fresh). */
  dryRun?: boolean;
}

/**
 * Canonical interface every intelligence module must implement.
 * Register modules in server/repo/agent-registry.ts.
 */
export interface IntelligenceModule {
  readonly moduleId:     AgentId;
  readonly systemPrompt: string;
  analyze(input: ModuleInput): Promise<AgentResult>;
}

// ─── Forge input ──────────────────────────────────────────────

/**
 * Input to the Forge planning module.
 * Budget cap: 20 findings total, 5 per upstream module.
 * Forge returns insufficient_evidence if totalFindingsAvailable === 0.
 */
export interface ForgeInput {
  repoFullName: string;
  branch:       string;
  /** Findings from upstream modules, trimmed to budget cap before passing. */
  findingsByModule: {
    cipher?:   CipherFinding[];
    sentinel?: CipherFinding[];
    pulse?:    CipherFinding[];
    atlas?:    ArchitectureTree;
  };
  /** Total findings available before budget cap was applied. */
  totalFindingsAvailable: number;
}

// ─── Forge result ─────────────────────────────────────────────

export interface ForgeRoadmapStep {
  priority:    "P0" | "P1" | "P2";
  title:       string;
  description: string;
  /** File paths that should be modified for this step. */
  targetFiles: string[];
  /** Finding IDs that motivated this step. */
  sourcedFrom: string[];
}

export interface ForgeResult {
  agentId:      "forge";
  repoFullName: string;
  status:       ModuleStatus;
  /** Null when status is not "success". */
  roadmap:      ForgeRoadmapStep[] | null;
  /** Human-readable explanation when status !== "success". */
  message?:     string;
  persistedAt:  string | null;
}

// ─── Snapshot entry ───────────────────────────────────────────

export interface SnapshotEntry {
  path:    string;
  blobSHA: string;
}

// ─── Staleness result ─────────────────────────────────────────

export interface StalenessResult {
  repoFullName: string;
  branch:       string;
  /** Files whose blobSHA changed since the last stored snapshot. */
  changedFiles: SnapshotEntry[];
  /** Files present in the snapshot but missing from the current tree (deleted). */
  removedFiles: string[];
  /** Files in the current tree not present in the stored snapshot (new). */
  newFiles:     SnapshotEntry[];
  /** True if a snapshot existed to compare against. */
  hadPriorSnapshot: boolean;
  /** Node IDs that have at least one stale associated file. */
  staleNodeIds: string[];
}
