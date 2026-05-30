/**
 * Atlas — Architecture Intelligence Module.
 *
 * Analyses a repository's structural architecture from its file tree.
 * Unlike Cipher/Sentinel/Pulse (which analyse individual files), Atlas
 * analyses the WHOLE repository tree to produce domain-level findings.
 *
 * Atlas does NOT call the AI provider for its structural findings — it derives
 * architecture intelligence directly from `buildDomainMap()`, which uses
 * directory-prefix matching on the already-fetched tree (zero extra API calls).
 *
 * Atlas findings surface in the Architecture Workspace page.
 *
 * Structural findings produced:
 *   - Domain distribution (which layers are heavy / light)
 *   - Missing architectural layers (no auth layer, no test layer, etc.)
 *   - Domain coupling signals (files belonging to multiple layers)
 *   - Size imbalance (one domain dwarfing all others — possible God Domain)
 *
 * Result stored in FileIntelligence with filePath = "__repo__" (repo-level record).
 * agentId: "atlas" → separate row, never overwrites Cipher/Sentinel/Pulse.
 *
 * Null guard: if tree has < 2 domains detected, returns graceful empty state.
 * This prevents garbage findings on repos with non-standard layouts.
 */

import { fetchRepoTree }           from "@/services/github/tree";
import { buildDomainMap, deriveStructuralFingerprint } from "@/server/repo/domain-map";
import type { CriticalFile, CriticalFileKind } from "@/server/repo/domain-map";
import { deriveCapabilities }       from "@/server/repo/capability-map";
import type { Capability }          from "@/server/repo/capability-map";
import { buildArchitectureGraph }   from "@/server/repo/architecture-wire";
import type { ArchitectureGraph }   from "@/server/repo/architecture-wire";
import { loadRepoDependencies }     from "@/server/repo/dependency-loader";
import {
  getFreshIntelligence,
  upsertFileIntelligence,
} from "@/server/repo/intelligence-store";
import type { CipherFinding, AgentResult, ArchitectureTree } from "@/types/intelligence";

// ─── Constants ────────────────────────────────────────────────

/** Virtual filePath used for repo-level Atlas findings. */
const ATLAS_REPO_FILE_PATH = "__repo__";

/** Minimum domains detected before Atlas produces structural findings. */
const MIN_DOMAINS_FOR_ANALYSIS = 2;

// ─── Structural analysis ──────────────────────────────────────

/**
 * Derive architecture findings from the domain map.
 * Pure function — no I/O, no AI call.
 */
/** Human-readable labels for critical file kinds, used in finding text. */
const CRITICAL_KIND_LABEL: Record<CriticalFileKind, string> = {
  "middleware":     "middleware",
  "route-handler":  "route handlers",
  "auth":           "auth config",
  "realtime":       "realtime/socket",
  "server-entry":   "server entry",
  "config":         "config",
};

function deriveArchitectureFindings(
  tree: ArchitectureTree,
  repoFullName: string,
  criticalFiles: CriticalFile[] = []
): CipherFinding[] {
  const findings: CipherFinding[] = [];
  const { domains } = tree;

  if (domains.length < MIN_DOMAINS_FOR_ANALYSIS) return findings;

  // ── Finding 1: Heavy domain inventory ────────────────────
  const heavyDomains = domains.filter(d => d.pressure === "heavy");
  if (heavyDomains.length > 0) {
    const names = heavyDomains.map(d => `${d.name} (${d.fileCount} files)`).join(", ");
    findings.push({
      id:          `${repoFullName}-implementation-heavy-domains`,
      type:        "implementation",
      title:       `${heavyDomains.length} heavy domain${heavyDomains.length > 1 ? "s" : ""} detected`,
      description: `Heavy domains (≥20 files): ${names}. These are core areas with significant implementation depth.`,
      confidence:  "confirmed",
      agentReasoning: `Derived from file tree: ${names} each contain ≥20 source files.`,
    });
  }

  // ── Finding 2: God Domain — one domain dominates ─────────
  const totalFiles = domains.reduce((sum, d) => sum + d.fileCount, 0);
  if (totalFiles > 0) {
    const godDomain = domains[0]; // sorted descending by fileCount
    const dominanceRatio = godDomain.fileCount / totalFiles;
    if (dominanceRatio > 0.5 && domains.length >= 3) {
      findings.push({
        id:            `${repoFullName}-pressure-god-domain`,
        type:          "pressure",
        title:         `God Domain: ${godDomain.name} holds ${Math.round(dominanceRatio * 100)}% of files`,
        description:   `"${godDomain.name}" contains ${godDomain.fileCount} of ${totalFiles} total files (${Math.round(dominanceRatio * 100)}%). Concentration of this magnitude can signal a layer doing too many jobs.`,
        confidence:    "confirmed",
        agentReasoning: `${godDomain.name} has ${godDomain.fileCount}/${totalFiles} files = ${Math.round(dominanceRatio * 100)}% of all files in detected domains.`,
        pressureLevel: "high",
      });
    }
  }

  // ── Finding 3: Missing expected layers ───────────────────
  const domainNames = new Set(domains.map(d => d.name));
  const missingLayers: string[] = [];

  // If there are API Routes but no Auth Layer, flag it
  if (domainNames.has("API Routes") && !domainNames.has("Auth Layer")) {
    missingLayers.push("Auth Layer");
  }
  // If there are Pages/UI but no UI Components (large UI with no component library)
  if (domainNames.has("Pages / UI") && !domainNames.has("UI Components") && totalFiles > 20) {
    missingLayers.push("UI Components");
  }
  // If there's a Server Logic but no Database Layer
  if (domainNames.has("Server Logic") && !domainNames.has("Database Layer") && !domainNames.has("Database Schema")) {
    missingLayers.push("Database Layer");
  }

  if (missingLayers.length > 0) {
    findings.push({
      id:          `${repoFullName}-integrity-missing-layers`,
      type:        "integrity",
      title:       `Missing architectural layers: ${missingLayers.join(", ")}`,
      description: `The repository has ${domains.map(d => d.name).join(", ")} but no detected files for: ${missingLayers.join(", ")}. This may indicate missing implementation or non-standard directory naming.`,
      confidence:  "inferred",
      agentReasoning: `Inferred from domain map: ${domainNames.size} layers detected, ${missingLayers.length} expected companion layers not found.`,
    });
  }

  // ── Finding 4: Light domains (thin layers) ───────────────
  const lightDomains = domains.filter(d => d.pressure === "light" && d.fileCount === 1);
  if (lightDomains.length >= 3) {
    const names = lightDomains.map(d => d.name).join(", ");
    findings.push({
      id:          `${repoFullName}-implementation-thin-layers`,
      type:        "implementation",
      title:       `${lightDomains.length} single-file layers detected`,
      description: `Domains with only 1 file: ${names}. Single-file layers may indicate scaffolded but unimplemented areas.`,
      confidence:  "confirmed",
      agentReasoning: `${lightDomains.length} domains (${names}) each contain exactly 1 file in the tree.`,
      pressureLevel: "low",
    });
  }

  // ── Finding 5: Critical File Registry ────────────────────
  // High-signal files that define runtime behaviour (middleware, route
  // handlers, auth, realtime, server entry, config). Detected by filename
  // in the same scan — confirmed-confidence because the files literally exist.
  if (criticalFiles.length > 0) {
    const countByKind = new Map<CriticalFileKind, number>();
    for (const c of criticalFiles) {
      countByKind.set(c.kind, (countByKind.get(c.kind) ?? 0) + 1);
    }
    const summary = [...countByKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${CRITICAL_KIND_LABEL[kind]} (${n})`)
      .join(", ");

    // A bounded, representative sample of paths — never dump the whole list.
    const sample = criticalFiles.slice(0, 8).map(c => c.path).join(", ");
    const more   = criticalFiles.length > 8 ? ` …and ${criticalFiles.length - 8} more` : "";

    findings.push({
      id:          `${repoFullName}-implementation-critical-files`,
      type:        "implementation",
      title:       `${criticalFiles.length} critical file${criticalFiles.length > 1 ? "s" : ""} detected`,
      description: `Files defining runtime behaviour by kind: ${summary}. Examples: ${sample}${more}.`,
      confidence:  "confirmed",
      agentReasoning: `Detected by filename during the tree scan: ${summary}. These files exist in the tree (path-evidence); content was not read.`,
      metadata:    { criticalFileKinds: [...countByKind.keys()] },
    });
  }

  return findings;
}

// ─── Public API ───────────────────────────────────────────────

export interface AtlasAnalyzeParams {
  owner:       string;
  repo:        string;
  branch:      string;
  githubToken: string;
  /** agentId is always "atlas" — exposed for type consistency with other modules. */
  dryRun?: boolean;
  /**
   * Force a fresh analysis, bypassing the structural-fingerprint cache.
   * Set when the user explicitly asks to refresh/re-run Atlas. Without it,
   * Atlas serves stored findings whenever the architecture shape is unchanged.
   */
  force?: boolean;
}

export interface AtlasResult extends AgentResult {
  /** The architecture tree that Atlas derived. Null for empty repos. */
  architectureTree: ArchitectureTree | null;
  /**
   * Evidence-based capability nodes (Authentication, Messaging, …) inferred
   * from the full path set. Deterministic, path-only — surfaced in the
   * capability lens. Empty when no capability signals are present.
   */
  capabilities: Capability[];
  /** Total number of repository paths Atlas can see (files + directories). */
  totalPaths: number;
  /** True when GitHub truncated the tree — capability/domain coverage partial. */
  truncated: boolean;
  /**
   * Deterministic architecture graph (Atlas Relationship Engine, Increment A+B):
   * system nodes + tiers from path capabilities, plus external-dependency edges
   * derived from package.json. Render-agnostic — feeds the architecture canvas.
   */
  architectureGraph: ArchitectureGraph;
}

/**
 * Analyse repository architecture with Atlas.
 *
 * No AI call — derives findings directly from the file tree.
 * Stores results in FileIntelligence with filePath = "__repo__", agentId = "atlas".
 *
 * Returns AtlasResult. Gracefully returns empty state if fewer than
 * MIN_DOMAINS_FOR_ANALYSIS domains are detected (non-standard repo layout).
 */
export async function analyzeRepoWithAtlas(
  params: AtlasAnalyzeParams
): Promise<AtlasResult> {
  const { owner, repo, branch, githubToken, dryRun = false, force = false } = params;
  const repoFullName = `${owner}/${repo}`;

  // 1. Fetch tree (uses 10-min in-process cache)
  const tree = await fetchRepoTree(owner, repo, branch, githubToken);

  // 1b. Capability + path-visibility derivation (deterministic, path-only).
  // Runs over the RAW node set (100% of paths incl. directories) so capability
  // detection sees critical files even in normally-filtered locations. Cheap
  // enough to recompute on every call, including cache hits.
  const fullNodes  = tree.rawNodes ?? tree.nodes;
  const capabilities = deriveCapabilities(fullNodes);
  const totalPaths   = fullNodes.length;
  const truncated    = tree.truncated ?? false;

  // 1c. Atlas Relationship Engine (Increment A+B): system nodes + tiers, plus
  // external-dependency edges from package.json. Deterministic, no AI. The
  // dependency read is bounded (≤3 package.json files) and fail-open.
  const dependencies     = await loadRepoDependencies(owner, repo, branch, githubToken, fullNodes);
  const architectureGraph = buildArchitectureGraph({ nodes: fullNodes, dependencies, truncated });

  // 2. Build domain map — null guard handled below
  const domainMap = buildDomainMap(tree);

  // 3. Build ArchitectureTree (typed for types/intelligence.ts)
  const architectureTree: ArchitectureTree = {
    domains:     domainMap.domains.map(d => ({
      name:      d.name,
      prefix:    d.prefix,
      fileCount: d.fileCount,
      pressure:  d.pressure,
    })),
    repoFullName,
    detectedAt:  domainMap.detectedAt,
  };

  // Null guard: too few domains → return graceful empty state
  if (architectureTree.domains.length < MIN_DOMAINS_FOR_ANALYSIS) {
    console.log(
      `[atlas] insufficient_domains repo=${repoFullName}` +
      ` detected=${architectureTree.domains.length} min=${MIN_DOMAINS_FOR_ANALYSIS}`
    );
    return {
      agentId:          "atlas",
      repoFullName,
      filePath:         ATLAS_REPO_FILE_PATH,
      blobSHA:          "tree",
      findings:         [],
      persistedAt:      null,
      nodeAttachments:  [],
      wasDeduped:       false,
      architectureTree: null,
      capabilities,
      totalPaths,
      truncated,
      architectureGraph,
    };
  }

  // 4. Derive a STRUCTURAL fingerprint as Atlas's "blobSHA" freshness key.
  // Atlas findings depend only on architecture shape (domain counts, pressure,
  // critical-file names) — never on file content. So this fingerprint is
  // content-insensitive: a one-line edit that doesn't change structure yields
  // the same value → cache hit → no wasted re-analysis. It changes only when
  // the architecture changes (file added/removed/moved, critical file appears).
  const treeSHA = deriveStructuralFingerprint(domainMap);

  // 5. Check for fresh cached intelligence (skipped on an explicit refresh)
  const cached = force
    ? null
    : await getFreshIntelligence(
        repoFullName, ATLAS_REPO_FILE_PATH, branch, treeSHA, "atlas"
      );
  if (cached) {
    console.log(`[atlas] cache_hit repo=${repoFullName} treeSHA=${treeSHA.slice(0, 8)}`);
    return {
      agentId:          "atlas",
      repoFullName,
      filePath:         ATLAS_REPO_FILE_PATH,
      blobSHA:          treeSHA,
      findings:         cached.findings,
      persistedAt:      cached.analyzedAt.toISOString(),
      nodeAttachments:  cached.nodeIds,
      wasDeduped:       true,
      architectureTree,
      capabilities,
      totalPaths,
      truncated,
      architectureGraph,
    };
  }

  if (dryRun) {
    return {
      agentId:          "atlas",
      repoFullName,
      filePath:         ATLAS_REPO_FILE_PATH,
      blobSHA:          treeSHA,
      findings:         [],
      persistedAt:      null,
      nodeAttachments:  [],
      wasDeduped:       false,
      architectureTree,
      capabilities,
      totalPaths,
      truncated,
      architectureGraph,
    };
  }

  // 6. Derive structural findings (no AI call)
  const findings = deriveArchitectureFindings(
    architectureTree, repoFullName, domainMap.criticalFiles
  );

  // 7. Node IDs — atlas attaches to section-domains (all domain nodes)
  const nodeIds = architectureTree.domains.length > 0
    ? ["section-domains", ...architectureTree.domains.map(d =>
        `domain-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      )]
    : [];

  const confidence = findings.some(f => f.confidence === "confirmed") ? "strong" : "partial";

  // 8. Persist (non-fatal on error)
  let persistedAt: string | null = null;
  let wasDeduped = false;

  try {
    const { record, wasDeduped: duped } = await upsertFileIntelligence({
      repoFullName,
      filePath:   ATLAS_REPO_FILE_PATH,
      blobSHA:    treeSHA,
      branch,
      agentId:    "atlas",
      findings,
      nodeIds,
      confidence,
    });
    persistedAt = record.analyzedAt.toISOString();
    wasDeduped  = duped;
    console.log(
      `[atlas] persisted repo=${repoFullName}` +
      ` findings=${findings.length}` +
      ` domains=${architectureTree.domains.length}` +
      ` deduped=${wasDeduped}`
    );
  } catch (err) {
    console.error(`[atlas] persist_failed repo=${repoFullName}`, err);
  }

  return {
    agentId:          "atlas",
    repoFullName,
    filePath:         ATLAS_REPO_FILE_PATH,
    blobSHA:          treeSHA,
    findings,
    persistedAt,
    nodeAttachments:  nodeIds,
    wasDeduped,
    architectureTree,
    capabilities,
    totalPaths,
    truncated,
    architectureGraph,
  };
}
