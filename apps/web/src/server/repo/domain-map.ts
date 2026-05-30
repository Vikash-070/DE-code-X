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

/**
 * High-signal file kinds that define how the system behaves at runtime.
 * Detected by filename in the same O(n) pass as domain classification —
 * this is the "Critical File Registry" (pipeline stage 3) without a second scan.
 */
export type CriticalFileKind =
  | "middleware"     // middleware.ts — request interception / auth gating
  | "route-handler"  // route.ts — Next.js App Router endpoint
  | "auth"           // auth.ts / auth.config.ts — authentication wiring
  | "realtime"       // socket.ts / ws.ts — websocket / realtime entry
  | "server-entry"   // server.ts — custom server bootstrap
  | "config";        // *.config.ts — build / framework configuration

export interface CriticalFile {
  /** Full repo-relative path, e.g. "src/middleware.ts". */
  path:   string;
  /** Why this file is structurally important. */
  kind:   CriticalFileKind;
  /** Domain this file belongs to, or null if outside any known domain (e.g. root config). */
  domain: string | null;
  /** GitHub blob SHA — enables per-file freshness without re-reading content. */
  sha:    string;
}

export interface ArchitecturalDomainMap {
  /** Detected domains, sorted by fileCount descending (heaviest first). */
  domains:      ArchitecturalDomain[];
  /**
   * Critical files detected by filename in the same scan pass.
   * Empty array when none found. Bounded by repo's critical-file count (tiny).
   */
  criticalFiles: CriticalFile[];
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

// ─── Critical file detection ──────────────────────────────
// Precise, basename-anchored rules — one O(1) test per blob in the main scan.
// Deliberately high-signal: we want the files that define system behaviour,
// not every file that happens to contain a keyword. Order matters only for
// reporting; each basename matches at most one kind (first hit wins).

const CRITICAL_RULES: ReadonlyArray<{ kind: CriticalFileKind; test: RegExp }> = [
  { kind: "middleware",    test: /^middleware\.[mc]?[jt]s$/ },
  { kind: "route-handler", test: /^route\.[mc]?[jt]s$/ },
  { kind: "auth",          test: /^auth(\.config)?\.[mc]?[jt]sx?$/ },
  { kind: "realtime",      test: /^(socket|ws)(\.[a-z]+)?\.[mc]?[jt]s$/ },
  { kind: "server-entry",  test: /^server\.[mc]?[jt]s$/ },
  { kind: "config",        test: /\.config\.[mc]?[jt]s$/ },
];

/**
 * Classify a path as a critical file by its basename, or null if ordinary.
 * Pure, allocation-light: lowercases the basename and runs ≤6 regex tests.
 */
function classifyCriticalFile(path: string): CriticalFileKind | null {
  const slash = path.lastIndexOf("/");
  const base  = (slash === -1 ? path : path.slice(slash + 1)).toLowerCase();
  for (const { kind, test } of CRITICAL_RULES) {
    if (test.test(base)) return kind;
  }
  return null;
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
  // Critical files detected in the same pass — see classifyCriticalFile().
  const criticalFiles: CriticalFile[] = [];

  for (const node of tree.nodes) {
    const pathLower = node.path.toLowerCase();
    let matchedDomain: string | null = null;

    for (const [prefix, domainName] of SORTED_PREFIXES) {
      // Match: path starts with "prefix/" or path IS exactly "prefix"
      if (pathLower.startsWith(prefix + "/") || pathLower === prefix) {
        matchedDomain = domainName;
        const existing = counts.get(prefix);
        if (existing) {
          existing.count++;
        } else {
          counts.set(prefix, { name: domainName, prefix, count: 1 });
        }
        break; // longest-match wins — do not fall through to shorter prefix
      }
    }
    // Files not matching any prefix are silently ignored for domain counts.
    // Root-level config files (tsconfig.json etc.) carry no domain signal —
    // but some ARE critical files, so the registry below still considers them.

    // Critical File Registry: blobs only, single O(1) basename test.
    // Runs even when matchedDomain is null (e.g. root next.config.ts).
    if (node.type === "blob") {
      const kind = classifyCriticalFile(node.path);
      if (kind) {
        criticalFiles.push({
          path:   node.path,
          kind,
          domain: matchedDomain,
          sha:    node.sha,
        });
      }
    }
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
    ` critical=${criticalFiles.length}` +
    ` top=${domains[0]?.name ?? "none"} (${domains[0]?.fileCount ?? 0} files)`
  );

  return {
    domains,
    criticalFiles,
    repoFullName: `${tree.owner}/${tree.repo}`,
    detectedAt:   Date.now(),
  };
}

// ─── Structural fingerprint (freshness signal) ────────────
// Atlas findings are PURELY structural — they depend on domain counts,
// pressure, and critical-file names, never on file CONTENT. So the freshness
// signal must be content-insensitive: it changes only when the architecture
// shape changes (file added/removed/moved between domains, or a critical file
// appearing/disappearing). A content-only edit yields the SAME fingerprint →
// cache hit → zero wasted re-analysis. This deliberately does NOT hash blob
// SHAs, which would churn the cache on every commit for no semantic reason.

/** Deterministic, non-cryptographic 32-bit hash (FNV-1a) → 8-char hex. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Derive a stable, content-insensitive fingerprint of the repository's
 * architectural shape. Two trees with identical structure but different file
 * contents (different blob SHAs) produce the SAME fingerprint.
 *
 * Used by Atlas as its `blobSHA` freshness key: re-analysis is triggered only
 * when this value changes, i.e. only when the architecture actually changed.
 */
export function deriveStructuralFingerprint(map: ArchitecturalDomainMap): string {
  const domainSig = map.domains
    .map(d => `${d.name}:${d.fileCount}:${d.pressure}`)
    .sort()
    .join("|");
  const criticalSig = map.criticalFiles
    .map(c => `${c.kind}:${c.path}`)
    .sort()
    .join("|");
  const hash = fnv1aHex(`${domainSig}#${criticalSig}`);
  return `arch-${map.domains.length}d-${map.criticalFiles.length}c-${hash}`;
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
