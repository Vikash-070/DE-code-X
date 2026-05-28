/**
 * V1 Repository System Registry
 *
 * Builds and caches a `RepositorySystemMap` for a repository.
 * Signal source: package.json `dependencies` only (v1).
 * Tree scan evidence deferred to v2.
 *
 * Persistence: in-process Map with 60-min TTL.
 * TODO: replace with Supabase Storage blob for serverless resilience.
 * In a serverless environment (Vercel), the effective TTL is the function
 * instance lifetime — the 60-min TTL applies only in persistent runtimes.
 *
 * Error contract: `getOrBuildSystemMap()` ALWAYS returns null on failure.
 * Callers must handle null gracefully by omitting the system section from prompts.
 */

import { clerkClient } from "@clerk/nextjs/server";
import { fetchFileContent } from "@/services/github/file";
import { searchTree, type RepoTree } from "@/services/github/tree";
import {
  PACKAGE_SIGNALS
} from "./package-signals";
import type {
  RepositorySystemMap,
  RepoSystem,
  SystemName
} from "./system-vocabulary";

// Re-export types so callers only need one import path
export type { RepositorySystemMap, RepoSystem } from "./system-vocabulary";

// ─── In-process cache ─────────────────────────────────────────
// Keyed by "owner/repo". Survives request lifetime in development.
// TODO: replace with Supabase Storage for serverless-safe persistence.

interface CacheEntry {
  map:       RepositorySystemMap;
  expiresAt: number;
}

const systemMapCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS   = 60 * 60 * 1_000; // 60 minutes

// ─── Public API ───────────────────────────────────────────────

/**
 * Get or build the system map for a repository.
 *
 * Common path (cache hit): zero network calls — instant return.
 * Cold path: 1-2 GitHub API calls (~500-1500ms depending on file size).
 *
 * @param repoFullName  GitHub full name e.g. "acme/my-app"
 * @param clerkId       Clerk user ID — used to fetch GitHub OAuth token
 * @param language      Primary repo language from GitHub metadata (nullable)
 */
export async function getOrBuildSystemMap(
  repoFullName: string,
  clerkId:      string,
  language:     string | null
): Promise<RepositorySystemMap | null> {
  const cacheKey = repoFullName;

  // ── 1. Cache check — zero network calls on hit ────────────────
  const cached = systemMapCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[system-registry] cache_hit repo=${cacheKey}`);
    return cached.map;
  }

  // ── 2. Fetch GitHub token ─────────────────────────────────────
  let githubToken: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(clerkId, "github");
    githubToken  = tokens.data[0]?.token;
  } catch {
    console.log(`[system-registry] build_failed repo=${cacheKey} reason=clerk_token_fetch_failed`);
    return null;
  }

  if (!githubToken) {
    console.log(`[system-registry] build_failed repo=${cacheKey} reason=github_not_connected`);
    return null;
  }

  // ── 3. Build map ──────────────────────────────────────────────
  const t0 = Date.now();
  try {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return null;

    const map = await buildSystemMap(owner, repo, githubToken, language, repoFullName);
    if (!map) return null;

    // Store with TTL
    systemMapCache.set(cacheKey, { map, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log(
      `[system-registry] built` +
      ` repo=${cacheKey}` +
      ` systems=${map.systems.length}` +
      ` stack=${map.primaryStack}` +
      ` duration=${Date.now() - t0}ms`
    );
    return map;
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80);
    console.log(`[system-registry] build_failed repo=${cacheKey} reason=${reason}`);
    return null;
  }
}

/**
 * Evict a specific repo from the cache (e.g. after a push event).
 * No-op if the repo is not cached.
 */
export function evictSystemMap(repoFullName: string): void {
  systemMapCache.delete(repoFullName);
}

// ─── Build logic ──────────────────────────────────────────────

async function buildSystemMap(
  owner:        string,
  repo:         string,
  token:        string,
  language:     string | null,
  repoFullName: string
): Promise<RepositorySystemMap | null> {

  // ── 1. Fetch package.json ────────────────────────────────────
  // Try root first; fall back to known monorepo paths when root
  // has fewer than 5 production dependencies (workspace root pattern).
  let packageJson: Record<string, unknown> | null = null;

  try {
    const rootFile = await fetchFileContent(owner, repo, "package.json", token);
    packageJson    = parsePackageJson(rootFile.content);
  } catch {
    // Root package.json not found or content invalid — try fallbacks
  }

  // Monorepo fallback: root manifest may be workspace metadata with no real deps
  if (!packageJson || getDepCount(packageJson) < 5) {
    const fallbackPaths = [
      "apps/web/package.json",
      "frontend/package.json",
      "app/package.json",
      "client/package.json",
    ];
    for (const fallbackPath of fallbackPaths) {
      try {
        const fallbackFile = await fetchFileContent(owner, repo, fallbackPath, token);
        const fallbackJson = parsePackageJson(fallbackFile.content);
        if (fallbackJson && getDepCount(fallbackJson) >= 5) {
          packageJson = fallbackJson;
          break;
        }
      } catch {
        // Path doesn't exist — continue to next fallback
      }
    }
  }

  if (!packageJson) return null;

  // ── 2. Extract production dependencies only ──────────────────
  const prodDeps = extractProdDeps(packageJson);
  if (prodDeps.size === 0) return null;

  // ── 3. Match packages to canonical systems ───────────────────
  // Accumulates unique components per system name.
  const systemAccumulator = new Map<SystemName, Set<string>>();

  for (const [pkg] of prodDeps) {
    // Skip @types/* — type definitions are never production systems
    if (pkg.startsWith("@types/")) continue;

    const signal = PACKAGE_SIGNALS[pkg];
    if (!signal) continue;

    const existing = systemAccumulator.get(signal.system);
    if (existing) {
      existing.add(signal.component);
    } else {
      systemAccumulator.set(signal.system, new Set([signal.component]));
    }
  }

  // ── 4. Build systems array (8 max) ───────────────────────────
  // v1: all detected systems have status="partial" (package-only evidence).
  // status="strong" requires tree-scan evidence (v2).
  const systems: RepoSystem[] = [];

  for (const [name, components] of systemAccumulator) {
    if (systems.length >= 8) break;
    systems.push({
      name,
      status:          "partial",
      stackComponents: [...components],
      evidenceFiles:   [],           // populated in v2
    });
  }

  if (systems.length === 0) return null;

  // ── 5. Derive primaryStack from package.json metadata ────────
  const primaryStack = derivePrimaryStack(packageJson, language);

  return {
    repoFullName,
    generatedAt: new Date().toISOString(),
    systems,
    primaryStack,
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function parsePackageJson(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getDepCount(pkg: Record<string, unknown>): number {
  const deps = pkg["dependencies"];
  return deps && typeof deps === "object" ? Object.keys(deps).length : 0;
}

/**
 * Extract only production dependencies (the "dependencies" key).
 * Intentionally excludes devDependencies, peerDependencies, optionalDependencies.
 * devDependencies contain test tooling, linters, and build tools — not production systems.
 */
function extractProdDeps(pkg: Record<string, unknown>): Map<string, string> {
  const deps = pkg["dependencies"];
  if (!deps || typeof deps !== "object") return new Map();
  return new Map(
    Object.entries(deps as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

// ─── v2 Evidence enrichment ───────────────────────────────
// Upgrades the system map from v1 (package.json only, "partial") to
// v2 (source-confirmed, "strong") by scanning the in-memory repo tree.
//
// Called in route.ts after both the system map and tree are resolved.
// Cost: ~8 × (keywords per system) in-memory searchTree() calls = 2-5ms.
// Zero GitHub API calls — operates on the already-fetched tree.

/**
 * Per-system keywords used to find source-file evidence.
 *
 * Multiple keywords per system improve recall across different naming conventions:
 * e.g. a repo might name its auth files "middleware.ts", "clerk.ts", or "session.ts"
 * — any of these confirms the Authentication system is actively implemented.
 *
 * Test files are excluded downstream (via EVIDENCE_SKIP_PATTERNS).
 */
const SYSTEM_EVIDENCE_KEYWORDS: Record<SystemName, string[]> = {
  "Authentication":          ["auth", "middleware", "clerk", "session", "login", "guard"],
  "Database":                ["prisma", "db", "schema", "migration", "repository", "drizzle"],
  "AI Orchestration":        ["ai", "openai", "openrouter", "anthropic", "prompt", "llm", "model"],
  "Realtime Messaging":      ["socket", "realtime", "pusher", "websocket", "channel", "broadcast"],
  "File Uploads":            ["upload", "storage", "s3", "blob", "bucket", "media"],
  "Payments":                ["stripe", "payment", "checkout", "billing", "webhook"],
  "Queue Systems":           ["queue", "worker", "job", "cron", "bull", "inngest", "trigger"],
  "Infrastructure/Caching":  ["redis", "cache", "rate", "upstash", "limit"],
};

const EVIDENCE_MAX_FILES = 3; // max evidence paths per system (keeps token budget tight)

const EVIDENCE_SKIP_PATTERNS = [
  ".test.",
  ".spec.",
  "__tests__",
  "/__mocks__/",
  "/test/",
  ".stories.",
];

/**
 * Upgrade system map evidence from v1 (package-only) to v2 (source-confirmed).
 *
 * For each detected system, runs keyword searches against the in-memory tree.
 * If matching source files are found:
 *   - system.status upgrades "partial" → "strong"
 *   - system.evidenceFiles populated with up to 3 real file paths
 *
 * Pure function — returns a new RepositorySystemMap without mutating the cached v1 map.
 * The v1 cache in systemMapCache is left unchanged; callers hold the enriched copy.
 *
 * @param map   - v1 system map (package.json only, all status="partial")
 * @param tree  - In-memory repo tree from fetchRepoTree() (10-min TTL cache)
 */
export function enrichSystemMapWithTree(
  map:  RepositorySystemMap,
  tree: RepoTree
): RepositorySystemMap {
  const enrichedSystems: RepoSystem[] = map.systems.map(sys => {
    const keywords  = SYSTEM_EVIDENCE_KEYWORDS[sys.name] ?? [];
    const seen      = new Set<string>();
    const evidence: string[] = [];

    for (const keyword of keywords) {
      if (evidence.length >= EVIDENCE_MAX_FILES) break;

      const hits = searchTree(tree, keyword, 6);
      for (const hit of hits) {
        // Skip test/mock/story files — they confirm package existence but not production usage
        const isTestFile = EVIDENCE_SKIP_PATTERNS.some(p => hit.path.includes(p));
        if (isTestFile) continue;

        if (!seen.has(hit.path)) {
          seen.add(hit.path);
          evidence.push(hit.path);
        }
        if (evidence.length >= EVIDENCE_MAX_FILES) break;
      }
    }

    // No matching source files — keep original "partial" status
    if (evidence.length === 0) return sys;

    return {
      ...sys,
      status:        "strong" as const,
      evidenceFiles: evidence,
    };
  });

  const strongCount = enrichedSystems.filter(s => s.status === "strong").length;
  console.log(
    `[system-registry] v2_enriched` +
    ` strong=${strongCount}/${enrichedSystems.length}` +
    ` repo=${map.repoFullName}`
  );

  return {
    ...map,
    systems: enrichedSystems,
  };
}

/**
 * Infer a human-readable primary stack label from package.json dependencies
 * and the GitHub-reported primary language.
 */
function derivePrimaryStack(
  pkg:      Record<string, unknown>,
  language: string | null
): string {
  const deps = pkg["dependencies"];
  if (!deps || typeof deps !== "object") return language ?? "Unknown";

  const d = deps as Record<string, unknown>;
  const parts: string[] = [language ?? "TypeScript"];

  // Framework detection — first match wins
  if ("next" in d)         parts.push("Next.js");
  else if ("remix" in d)   parts.push("Remix");
  else if ("nuxt" in d)    parts.push("Nuxt");
  else if ("@nuxt/kit" in d) parts.push("Nuxt");
  else if ("astro" in d)   parts.push("Astro");
  else if ("fastify" in d) parts.push("Fastify");
  else if ("hono" in d)    parts.push("Hono");
  else if ("express" in d) parts.push("Express");

  // React detection — only when no meta-framework already matched
  const hasMetaFramework = parts.some(
    p => p === "Next.js" || p === "Remix" || p === "Nuxt" || p === "Astro"
  );
  if (!hasMetaFramework && "react" in d) {
    parts.push("React");
  }

  return parts.join(" / ");
}
