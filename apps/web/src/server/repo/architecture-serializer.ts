/**
 * Architecture Workspace — tree serializer.
 *
 * Converts the server-side domain map and system map into a frontend-ready
 * ArchitectureTreeNode[] for the architecture workspace page.
 *
 * Output structure (parallel sections model — approved in autoplan D3):
 *
 *   [
 *     {
 *       id: "section-domains",
 *       label: "Structural Domains",
 *       type: "section",
 *       children: [ domain nodes... ]
 *     },
 *     {
 *       id: "section-systems",
 *       label: "Detected Systems",
 *       type: "section",
 *       children: [ system nodes (with evidence-file children for strong systems)... ]
 *     }
 *   ]
 *
 * Systems are NOT nested under domains. Mixing structural evidence (where code
 * lives) with logical evidence (what systems exist) would create false claims
 * about implementation quality.
 *
 * Evidence contract:
 *   - Evidence files match system keywords (filename proximity), NOT confirmed
 *     correct implementation. Every evidence node carries this caveat.
 *   - "strong" systems: source files found via tree keyword search.
 *   - "partial" systems: package.json dependency only, no source confirmation.
 *   - "directory-only" domains: directory exists in tree, no semantic analysis.
 */

import type { ArchitecturalDomainMap } from "./domain-map";
import type { RepositorySystemMap, RepoSystem } from "./system-registry";
import type { ArchitectureTreeNode, PressureLabel } from "@/types/architecture";

// ─── Public API ───────────────────────────────────────────────

/**
 * Serialize domain map + system map into a tree of ArchitectureTreeNode[].
 *
 * Both maps are optional: callers should pass null when a map failed to build.
 * The serializer returns only the sections it has data for — never empty sections.
 *
 * @param domainMap  - From buildDomainMap(tree). Null when tree fetch failed.
 * @param systemMap  - From enrichSystemMapWithTree(). Null when package.json missing.
 */
export function serializeArchitectureTree(
  domainMap:  ArchitecturalDomainMap | null,
  systemMap:  RepositorySystemMap    | null
): ArchitectureTreeNode[] {
  const sections: ArchitectureTreeNode[] = [];

  // ── 1. Structural Domains section ────────────────────────────
  if (domainMap && domainMap.domains.length > 0) {
    const domainNodes: ArchitectureTreeNode[] = domainMap.domains.map(domain => ({
      id:               `domain-${slugify(domain.prefix)}`,
      label:            domain.name,
      type:             "domain",
      confidence:       "directory-only",
      pressure:         domain.pressure as PressureLabel,
      fileCount:        domain.fileCount,
      prefix:           domain.prefix,
      integrityScore:   null,
      trustBoundaryNote: null,
      weakSeams:        null,
    }));

    sections.push({
      id:               "section-domains",
      label:            "Structural Domains",
      type:             "section",
      confidence:       "directory-only",
      children:         domainNodes,
      integrityScore:   null,
      trustBoundaryNote: null,
      weakSeams:        null,
    });
  }

  // ── 2. Detected Systems section ───────────────────────────────
  if (systemMap && systemMap.systems.length > 0) {
    const systemNodes: ArchitectureTreeNode[] = systemMap.systems.map(sys =>
      serializeSystem(sys)
    );

    const hasStrong = systemMap.systems.some(s => s.status === "strong");
    const sectionLabel = hasStrong
      ? "Detected Systems"
      : "Detected Systems (package.json only)";

    sections.push({
      id:               "section-systems",
      label:            sectionLabel,
      type:             "section",
      confidence:       hasStrong ? "strong" : "partial",
      children:         systemNodes,
      integrityScore:   null,
      trustBoundaryNote: null,
      weakSeams:        null,
    });
  }

  return sections;
}

// ─── Private helpers ──────────────────────────────────────────

function serializeSystem(sys: RepoSystem): ArchitectureTreeNode {
  const isStrong = sys.status === "strong";
  const confidence = isStrong ? "strong" : "partial";

  // Evidence-file children — only for strong systems with confirmed files
  const children: ArchitectureTreeNode[] | undefined = isStrong && sys.evidenceFiles.length > 0
    ? sys.evidenceFiles.map((filePath, i) => ({
        id:               `evidence-${slugify(sys.name)}-${i}`,
        label:            shortPath(filePath),
        type:             "evidence-file" as const,
        confidence:       "strong" as const,
        // Full path stored for tooltip / copy-path action
        prefix:           filePath,
        evidenceNote:     "Filename matches system keywords — not a guarantee of correctness",
        integrityScore:   null,
        trustBoundaryNote: null,
        weakSeams:        null,
      }))
    : undefined;

  const evidenceNote = !isStrong
    ? "Detected from package.json — source files not yet read"
    : undefined;

  return {
    id:               `system-${slugify(sys.name)}`,
    label:            sys.name,
    type:             "system",
    confidence,
    systemName:       sys.name,
    components:       sys.stackComponents.length > 0 ? sys.stackComponents : undefined,
    evidenceFiles:    isStrong ? sys.evidenceFiles : undefined,
    evidenceNote,
    children,
    integrityScore:   null,
    trustBoundaryNote: null,
    weakSeams:        null,
  };
}

/**
 * Shorten a file path for display.
 * "src/server/ai/vhash-prompt.ts" → "vhash-prompt.ts"
 * "middleware.ts" → "middleware.ts"
 */
function shortPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/**
 * Convert an arbitrary string to a URL-safe slug for stable node IDs.
 * "AI Orchestration" → "ai-orchestration"
 * "src/app/api" → "src-app-api"
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
