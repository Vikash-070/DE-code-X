/**
 * Architectural domain map builder.
 *
 * Scans the in-memory repo tree to detect structural domains
 * (API Routes, UI Components, AI Layer, etc.) from directory prefixes.
 *
 * Uses the same tree that the retrieval pipeline already fetched — zero API calls.
 * Produces an ArchitecturalDomainMap for architecture-aware V# responses (T2.3).
 *
 * Domain detection strategy:
 *   - Ordered by prefix length (longest match wins)
 *   - First matching prefix determines the domain for each file
 *   - Files not matching any known prefix are silently skipped (not "Other" noise)
 *
 * Evidence quality: path-evidence (structural) — files confirmed to exist in tree.
 * We know WHERE code lives, not WHAT it does. Semantic analysis requires file reads.
 *
 * Usage:
 *   T2.2 — domain scanner built, computed in route.ts, logged for observability.
 *   T2.3 — formatDomainMap() injected into V# system prompt for architecture answers.
 */

import type { RepoTree } from "@/services/github/tree";

// ─── Types ────────────────────────────────────────────────

export interface ArchitecturalDomain {
  /** Human-readable domain label, e.g. "API Routes", "AI Layer". */
  name:      string;
  /** Directory prefix used for detection, e.g. "src/app/api". */
  prefix:    string;
  /** Number of source files detected in this domain. */
  fileCount: number;
  /**
   * Implementation pressure relative to other domains.
   * heavy  ≥ 20 files — core / well-developed area
   * medium  5-19 files — moderate implementation
   * light   < 5 files — thin layer or nascent feature
   */
  pressure:  "heavy" | "medium" | "light";
}

export interface ArchitecturalDomainMap {
  /** Detected domains, sorted by fileCount descending (heaviest first). */
  domains:      ArchitecturalDomain[];
  /** GitHub full name, e.g. "acme/my-app". */
  repoFullName: string;
  /** Unix ms timestamp of when this map was built. */
  detectedAt:   number;
}

// ─── Domain prefix table ──────────────────────────────────
// Ordered longest-first so the most specific prefix always wins.
// e.g. "src/server/ai" must appear before "src/server" in DOMAIN_PREFIXES.
// The sort() call below enforces this regardless of entry order here.

const DOMAIN_PREFIXES: [string, string][] = [
  // ── Next.js App Router ─────────────────────────────────
  ["src/app/api",             "API Routes"],
  ["src/app/(api)",           "API Routes"],
  ["app/api",                 "API Routes"],
  // ── Server-side domain layers ──────────────────────────
  // Most specific sub-paths MUST precede "src/server" catch-all
  ["src/server/ai",           "AI Layer"],
  ["src/server/repo",         "Repository Intelligence"],
  ["src/server/db",           "Database Layer"],
  ["src/server/auth",         "Auth Layer"],
  ["src/server",              "Server Logic"],
  // ── Frontend ────────────────────────────────────────────
  ["src/app",                 "Pages / UI"],
  ["app",                     "Pages / UI"],
  ["src/pages",               "Pages / UI"],
  ["pages",                   "Pages / UI"],
  ["src/components",          "UI Components"],
  ["components",              "UI Components"],
  ["src/screens",             "UI Screens"],
  ["src/features",            "Feature Modules"],
  // ── Services and integrations ───────────────────────────
  ["src/services",            "Service Integrations"],
  ["services",                "Service Integrations"],
  // ── Shared utilities ────────────────────────────────────
  ["src/lib",                 "Shared Utilities"],
  ["lib",                     "Shared Utilities"],
  ["src/utils",               "Utilities"],
  ["utils",                   "Utilities"],
  ["src/helpers",             "Utilities"],
  // ── React patterns ──────────────────────────────────────
  ["src/hooks",               "React Hooks"],
  ["hooks",                   "React Hooks"],
  ["src/stores",              "State Management"],
  ["stores",                  "State Management"],
  ["src/context",             "React Context"],
  ["context",                 "React Context"],
  // ── Type definitions ────────────────────────────────────
  ["src/types",               "Type Definitions"],
  ["types",                   "Type Definitions"],
  // ── Configuration ───────────────────────────────────────
  ["src/config",              "Configuration"],
  ["config",                  "Configuration"],
  // ── Database ────────────────────────────────────────────
  ["prisma",                  "Database Schema"],
  ["migrations",              "Database Migrations"],
  ["drizzle",                 "Database Schema"],
  // ── Background work ─────────────────────────────────────
  ["src/workers",             "Background Workers"],
  ["workers",                 "Background Workers"],
  ["src/jobs",                "Background Jobs"],
  ["jobs",                    "Background Jobs"],
  ["src/queues",              "Queue Systems"],
  ["queues",                  "Queue Systems"],
  // ── Mobile / React Native ───────────────────────────────
  ["src/navigation",          "Navigation"],
  ["navigation",              "Navigation"],
  // ── Styles ──────────────────────────────────────────────
  ["src/styles",              "Styles"],
  ["styles",                  "Styles"],
  // ── Static assets (rarely in tree after filtering) ──────
  ["src/assets",              "Static Assets"],
  ["assets",                  "Static Assets"],
  ["public",                  "Static Assets"],
];

// Pre-sort by prefix length descending so longest/most-specific prefix wins.
// This means "src/server/ai" (13 chars) beats "src/server" (10 chars)
// without requiring careful ordering in DOMAIN_PREFIXES above.
const SORTED_PREFIXES = [...DOMAIN_PREFIXES].sort(
  ([a], [b]) => b.length - a.length
);

// ─── Pressure thresholds ──────────────────────────────────

const PRESSURE_HEAVY  = 20; // ≥ 20 files = "heavy" (core area)
const PRESSURE_MEDIUM =  5; // 5–19 files = "medium"
//                           < 5 files  = "light"

function pressureLabel(count: number): "heavy" | "medium" | "light" {
  if (count >= PRESSURE_HEAVY) return "heavy";
  if (count >= PRESSURE_MEDIUM) return "medium";
  return "light";
}

// ─── Public API ───────────────────────────────────────────

/**
 * Build an architectural domain map from an in-memory repo tree.
 *
 * Uses path-prefix matching to bucket files into known architectural domains.
 * Operates entirely on the already-fetched tree — zero API calls.
 *
 * Returns only domains with ≥ 1 file, sorted by fileCount descending.
 *
 * @param tree - RepoTree returned by fetchRepoTree()
 */
export function buildDomainMap(tree: RepoTree): ArchitecturalDomainMap {
  // Map: prefix → { name, prefix, count }
  const counts = new Map<string, { name: string; prefix: string; count: number }>();

  for (const node of tree.nodes) {
    const pathLower = node.path.toLowerCase();

    for (const [prefix, domainName] of SORTED_PREFIXES) {
      // Match: path starts with "prefix/" or path IS exactly "prefix"
      if (pathLower.startsWith(prefix + "/") || pathLower === prefix) {
        const existing = counts.get(prefix);
        if (existing) {
          existing.count++;
        } else {
          counts.set(prefix, { name: domainName, prefix, count: 1 });
        }
        break; // longest-match wins — do not fall through to shorter prefix
      }
    }
    // Files not matching any prefix are silently ignored.
    // Root-level config files (tsconfig.json etc.) carry no architectural signal.
  }

  const domains: ArchitecturalDomain[] = [];
  for (const { name, prefix, count } of counts.values()) {
    if (count === 0) continue;
    domains.push({
      name,
      prefix,
      fileCount: count,
      pressure:  pressureLabel(count),
    });
  }

  // Sort: most files first — highest implementation pressure leads
  domains.sort((a, b) => b.fileCount - a.fileCount);

  const heavy = domains.filter(d => d.pressure === "heavy").length;
  console.log(
    `[domain-map] built` +
    ` repo=${tree.owner}/${tree.repo}` +
    ` domains=${domains.length}` +
    ` heavy=${heavy}` +
    ` top=${domains[0]?.name ?? "none"} (${domains[0]?.fileCount ?? 0} files)`
  );

  return {
    domains,
    repoFullName: `${tree.owner}/${tree.repo}`,
    detectedAt:   Date.now(),
  };
}

/**
 * Format the domain map as a compact, token-efficient string for V# prompt injection.
 *
 * Not called in T2.2 — prepared for T2.3 (architecture context injection).
 * Heavy domains listed with file counts; light domains compressed to a name list.
 *
 * Example output (~120 tokens):
 *   Architecture shape:
 *     Heavy: Pages / UI (42 files), API Routes (31 files), Server Logic (28 files)
 *     Medium: Service Integrations (12 files), AI Layer (8 files)
 *     Light: Auth Layer, Repository Intelligence, Type Definitions
 *
 * @param map   - ArchitecturalDomainMap from buildDomainMap()
 * @param limit - Max domains to include total (default 10, prevents token bloat)
 */
export function formatDomainMap(map: ArchitecturalDomainMap, limit = 10): string {
  if (map.domains.length === 0) return "";

  const all    = map.domains.slice(0, limit);
  const heavy  = all.filter(d => d.pressure === "heavy");
  const medium = all.filter(d => d.pressure === "medium");
  const light  = all.filter(d => d.pressure === "light");

  const lines: string[] = ["Architecture shape:"];

  if (heavy.length > 0) {
    const str = heavy.map(d => `${d.name} (${d.fileCount} files)`).join(", ");
    lines.push(`  Heavy: ${str}`);
  }
  if (medium.length > 0) {
    const str = medium.map(d => `${d.name} (${d.fileCount} files)`).join(", ");
    lines.push(`  Medium: ${str}`);
  }
  if (light.length > 0) {
    const names = light.map(d => d.name).join(", ");
    lines.push(`  Light: ${names}`);
  }

  return lines.join("\n");
}
