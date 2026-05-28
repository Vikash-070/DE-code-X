/**
 * Multi-file repository context retrieval pipeline.
 *
 * Orchestrates: ref extraction → tree search → seed file fetch
 *   → import graph expansion → candidate ranking → context budget.
 *
 * Entry point: buildRetrievalContext()
 *
 * ARCHITECTURE:
 *   - Import expansion uses already-fetched seed content — no extra API calls
 *     for parsing. Expansion only adds GitHub calls for import-neighbour files.
 *   - Resolved import paths are validated against tree.nodes before fetching
 *     (prevents path-traversal via malicious repo content).
 *   - Circular imports handled via visitedPaths Set.
 *   - Never throws — every error degrades to returning null or partial results.
 *
 * BUDGET:
 *   Max 4 files · 6,000 chars/file · 20,000 chars total (~5K tokens @ 4 chars/token)
 *
 * TELEMETRY (server console):
 *   [repo] tree_cache_hit/miss         → from tree.ts
 *   [repo] search_start                → candidates found
 *   [repo] search_results              → top paths
 *   [repo] import_expansion            → per-seed expansion result
 *   [repo] retrieval_ranked            → post-ranking order and scores
 *   [repo] context_budget              → total chars and file count
 *   [repo] files_injected              → final paths and per-file char counts
 *   [repo] injected_tokens             → estimated token usage
 *   [repo] retrieval_ms                → total wall-clock time
 */

import { clerkClient } from "@clerk/nextjs/server";

import { fetchRepoTree, searchTree, listFolderContents, searchTreeByKeyword, type RepoTree } from "./tree";
import { fetchFileContent }                          from "./file";
import { parseImports, resolveTreePath }             from "./imports";
import type { CodeContext, RepoContextInput }        from "@/server/ai/vhash-prompt";

// ─── Types ────────────────────────────────────────────────

/** Minimal conversation turn — mirrors orchestrate/route.ts ConversationTurn */
export interface RetrievalTurn {
  role:    "user" | "assistant";
  content: string;
}

interface Candidate {
  path:        string;
  content:     string;
  truncated:   boolean;
  searchScore: number; // from searchTree ref priority
  hops:        number; // 0 = direct search hit, 1 = import neighbour
}

interface RankedCandidate extends Candidate {
  score: number; // final composite score
}

// ─── Context budget ───────────────────────────────────────

const BUDGET = {
  MAX_FILES:       4,
  MAX_CHARS_TOTAL: 20_000,
  MAX_CHARS_FILE:  6_000, // tighter than file.ts's 8K — budget across 4 files
} as const;

// ─── Code reference extraction ────────────────────────────
// Pulled from orchestrate/route.ts and improved with a larger PascalCase
// blocklist to reduce false positives from natural language.

const FILE_EXTENSION_PATTERN =
  /\b([\w\-./]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|css|scss|json|yaml|yml|sql|md|prisma|env))\b/gi;

const EXPLICIT_FILE_PATTERN =
  /(?:look\s+at|check|open|show\s+me|in|file|the)\s+["']?([\w\-./]+\.[a-z]{1,6})["']?/gi;

const PASCAL_CASE_PATTERN = /\b([A-Z][a-z]+(?:[A-Z][a-z]*)+)\b/g;

/**
 * Known-noisy PascalCase tokens that appear in natural language but are never
 * file names. Prevents false-positive tree searches.
 */
const PASCAL_BLOCKLIST = new Set([
  // Sentence-initial / common English words
  "This", "That", "There", "When", "Where", "With", "From", "Into",
  "Have", "Will", "Does", "What", "Which", "Some", "Most", "They",
  "Their", "These", "Those", "Then", "Here", "Also", "Just", "Even",
  "After", "Before", "While", "Until", "Since", "About", "Above",
  "Below", "Between", "Through", "Without", "Another",
  // Frameworks / libraries / providers (not filenames)
  "TypeScript", "JavaScript", "GitHub", "GitLab", "BitBucket",
  "React", "ReactDOM", "NextJs", "NextAuth",
  "OpenRouter", "OpenAI", "Anthropic", "Claude",
  "Supabase", "Prisma", "Postgres", "PostgreSQL", "MongoDB",
  "Clerk", "Stripe", "Tailwind", "Vercel", "Cloudflare",
  "Redis", "GraphQL", "RestAPI", "WebSocket",
]);

/**
 * Architectural noun keywords present in natural-language queries that indicate
 * the user wants to look at source code — even without explicit file references
 * or PascalCase names.
 *
 * Examples that now trigger retrieval (previously fell through to base prompt):
 *   "where is the rate limiting middleware?"
 *   "how does the webhook handler work?"
 *   "show me the auth guard"
 *   "explain the payment processor"
 *
 * Priority 50 — above PascalCase (40), below explicit file references (85/90).
 * Capture group 1 is the matched keyword, used directly as the tree search query.
 */
const NATURAL_LANGUAGE_PATTERN =
  /\b(middleware|handler|controller|service|repository|provider|factory|gateway|adapter|connector|router|schema|migration|validator|authenticator|authorizer|auth|authentication|authorization|guard|interceptor|cron|scheduler|webhook|worker|consumer|producer|processor|subscriber|publisher|resolver|pipeline|plugin|module|store|context|reducer|selector|hook|decorator|filter|listener|emitter|dispatcher|serializer|deserializer|transformer|formatter|parser|extractor|loader|seeder|fixture|seed|config|configuration|setup|initialization|architecture|structure)\b/gi;

/**
 * Folder/directory path patterns — highest priority (95).
 *
 * Detects queries asking about directory contents:
 *   "what's in the /api folder?"      → captures "api"
 *   "show me src/server/ai"           → captures "src/server/ai"
 *   "the auth directory"              → captures "auth"
 *   "what files are in services?"     → captures "services"
 *   "list the components folder"      → captures "components"
 *
 * These trigger the folder-listing path in buildRetrievalContext (paths only,
 * no file content fetch) rather than the normal file-retrieval path.
 * Priority 95 — above file extensions (90) so directory queries are tried first.
 *
 * Capture group 1 is the folder path, used as prefix in listFolderContents().
 */
const FOLDER_PATTERN =
  /(?:in\s+(?:the\s+)?|show\s+me\s+(?:the\s+)?|list\s+(?:the\s+)?|inside\s+(?:the\s+)?|inside\s+|what'?s?\s+in\s+(?:the\s+)?|explore\s+(?:the\s+)?)["']?([\w./\-]+(?:\/[\w./\-]+)*)["']?\s*(?:folder|directory|dir)?/gi;

/**
 * Standalone folder keywords — catches "the api directory", "the services folder".
 * Separate from FOLDER_PATTERN to avoid double-matching.
 */
const FOLDER_KEYWORD_PATTERN =
  /\b([\w./\-]+(?:\/[\w./\-]+)*)\s+(?:folder|directory|dir)\b/gi;

/**
 * Inventory query pattern — detects requests to list ALL files matching a keyword
 * across the entire repo tree. Priority 92.
 *
 * Returns paths-only (no content fetch) — answers structural questions cheaply.
 *
 * Matches:
 *   "what security files are in our repo?"  → "security"
 *   "show me all auth files"                → "auth"
 *   "list all payment files"                → "payment"
 *   "find database files"                   → "database"
 *   "are there any middleware files?"       → "middleware"
 *   "what test files exist?"                → "test"
 *
 * Does NOT match singular "what does the auth file do?" — that goes through
 * normal retrieval (NATURAL_LANGUAGE_PATTERN + searchTree).
 */
const INVENTORY_QUERY_PATTERN =
  /(?:(?:what|show\s+me|list|find)\s+(?:all\s+)?(?:the\s+)?(\w[\w-]*)(?:\s+related)?\s+files\b|are\s+there\s+(?:any\s+)?(\w[\w-]*)(?:\s+related)?\s+files\b)/gi;

/** Blocklist for INVENTORY_QUERY_PATTERN — very generic words that produce useless results */
const INVENTORY_BLOCKLIST = new Set([
  "all", "any", "the", "my", "our", "your", "some", "other", "new", "old",
  "big", "small", "main", "core", "base", "common", "shared", "lib",
]);

interface CodeRef {
  query:       string;
  priority:    number;    // higher → search first
  isFolder?:   boolean;   // true → use listFolderContents, not searchTree
  isInventory?: boolean;  // true → use searchTreeByKeyword (paths-only, cross-repo)
}

function extractCodeRefs(message: string): CodeRef[] {
  const refs: CodeRef[] = [];
  const seen = new Set<string>();

  const add = (query: string, priority: number, isFolder = false) => {
    const q = query.trim().toLowerCase();
    if (!q || seen.has(q)) return;
    // Filter out noise: single common words unlikely to be folder names
    if (isFolder && q.length < 2) return;
    seen.add(q);
    refs.push({ query: query.trim(), priority, isFolder });
  };

  // Folder/directory queries — highest priority (95), paths-only retrieval
  // "what's in the /api folder?", "show me src/server/ai", "the auth directory"
  for (const m of message.matchAll(FOLDER_PATTERN)) {
    const folderQuery = m[1]!.replace(/^\//, ""); // strip leading slash
    if (folderQuery) add(folderQuery, 95, true);
  }
  for (const m of message.matchAll(FOLDER_KEYWORD_PATTERN)) {
    const folderQuery = m[1]!.replace(/^\//, "");
    // Skip common false positives (single short words that are not directory names)
    if (folderQuery && folderQuery.length > 2 && !["the", "my", "your", "this"].includes(folderQuery)) {
      add(folderQuery, 95, true);
    }
  }

  // Inventory queries — priority 92, cross-repo keyword search (paths-only, no content fetch).
  // "what auth files are in our repo?", "show me all payment files", "list database files"
  // Only matches PLURAL "files" — singular "what does the auth file do?" goes through normal retrieval.
  for (const m of message.matchAll(INVENTORY_QUERY_PATTERN)) {
    const kw = (m[1] ?? m[2] ?? "").trim().toLowerCase();
    if (!kw || kw.length < 2 || INVENTORY_BLOCKLIST.has(kw)) continue;

    // Don't add as inventory if it's already a folder query (avoid double-listing)
    if (!seen.has(kw)) {
      seen.add(kw);
      refs.push({ query: kw, priority: 92, isInventory: true });
    }
  }

  // Explicit file extensions — highest priority for file retrieval
  for (const m of message.matchAll(FILE_EXTENSION_PATTERN)) {
    add(m[1]!, 90);
  }

  // "look at / in / check X.ext" explicit patterns
  for (const m of message.matchAll(EXPLICIT_FILE_PATTERN)) {
    add(m[1]!, 85);
  }

  // Natural-language architectural nouns — activates retrieval for queries like
  // "where is the rate limiting middleware?" or "how does the webhook handler work?"
  // without requiring an explicit filename or PascalCase symbol.
  // Priority 50: above PascalCase (40), below explicit file refs (85/90).
  for (const m of message.matchAll(NATURAL_LANGUAGE_PATTERN)) {
    add(m[1]!, 50);
  }

  // PascalCase component/class names — lower priority
  for (const m of message.matchAll(PASCAL_CASE_PATTERN)) {
    const name = m[1]!;
    if (name.length < 4 || PASCAL_BLOCKLIST.has(name)) continue;
    add(name, 40);
  }

  return refs.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

// ─── Import expansion ─────────────────────────────────────

/**
 * Given a set of already-fetched seed files, expand to their immediate import
 * neighbours (1 hop only). Uses seed file content that was already fetched —
 * no extra GitHub API calls are needed just to parse imports.
 *
 * Resolved paths are validated against tree.nodes before fetching to prevent
 * path-traversal via malicious repo content.
 *
 * @param seedFiles    — Seed files with content already available
 * @param tree         — Full repo tree (for path validation)
 * @param owner        — GitHub user/org
 * @param repo         — Repository name
 * @param token        — GitHub OAuth token (server-side only)
 * @param visitedPaths — Prevents re-fetching already-known paths and circular imports
 */
async function expandImports(
  seedFiles:    Array<{ path: string; content: string }>,
  tree:         RepoTree,
  owner:        string,
  repo:         string,
  token:        string,
  visitedPaths: Set<string>
): Promise<Candidate[]> {
  const treePaths  = tree.nodes.map((n) => n.path);
  const treePathSet = new Set(treePaths);
  const expanded:  Candidate[] = [];

  for (const seed of seedFiles) {
    const specifiers  = parseImports(seed.content);
    const resolved:   string[] = [];

    for (const spec of specifiers) {
      const rp = resolveTreePath(treePaths, spec, seed.path);
      if (!rp) continue;

      // SECURITY: resolved path MUST exist in tree.nodes — prevents path
      // traversal via a repo that imports ../../../../etc/passwd or similar
      if (!treePathSet.has(rp)) continue;

      if (visitedPaths.has(rp)) continue;
      resolved.push(rp);
    }

    // Cap per-seed expansion to avoid runaway API calls in large files
    const toFetch = resolved.slice(0, 3);

    console.log(
      `[repo] import_expansion seed=${seed.path} ` +
      `resolved=${resolved.length} fetching=[${toFetch.join(",")}]`
    );

    if (!toFetch.length) continue;

    // Fetch neighbour files concurrently; skip failures silently
    const results = await Promise.allSettled(
      toFetch.map((p) => fetchFileContent(owner, repo, p, token, undefined))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const path   = toFetch[i]!;
      if (result.status === "rejected") {
        console.log(`[repo] import_expansion fetch_failed path=${path}`);
        continue;
      }
      visitedPaths.add(path);
      expanded.push({
        path:        result.value.path,
        content:     result.value.content,
        truncated:   result.value.truncated,
        searchScore: 30,
        hops:        1
      });
    }
  }

  return expanded;
}

// ─── Candidate ranking ────────────────────────────────────

/**
 * Score and rank candidate files by multiple signals:
 *   - searchScore  (from tree search — ref priority)
 *   - import proximity (seed file vs neighbour)
 *   - file role heuristics (route, middleware, hook, service files)
 *   - conversation history (previously referenced paths score higher)
 *
 * Higher score = inject first into the context budget.
 */
function rankCandidates(
  candidates: Candidate[],
  message:    string,
  history:    RetrievalTurn[]
): RankedCandidate[] {
  // Build set of lowercased filenames from recent conversation turns
  const historyMentioned = new Set<string>();
  for (const turn of history.slice(-6)) {
    for (const m of turn.content.matchAll(/\b([\w\-./]+\.(ts|tsx|js|jsx|py|go))\b/g)) {
      historyMentioned.add(m[1]!.toLowerCase());
    }
  }

  const msgLower = message.toLowerCase();

  return candidates
    .map((c): RankedCandidate => {
      let score = c.searchScore;

      // Import proximity
      if (c.hops === 0)      score += 30; // direct search hit
      else if (c.hops === 1) score += 15; // 1-hop import neighbour

      // File role heuristics
      const filename = (c.path.split("/").pop() ?? "").toLowerCase();
      if (filename.includes("route"))                          score += 15;
      if (filename.includes("middleware"))                     score += 12;
      if (filename.includes("page"))                          score += 10;
      if (filename.includes("layout"))                        score += 8;
      if (filename.includes("service"))                       score += 8;
      if (filename.startsWith("use") && filename.length > 4) score += 5; // hooks
      if (filename.includes("hook"))                          score += 5;
      if (filename.includes("util") || filename.includes("helper")) score -= 5;
      if (filename.includes(".test.") || filename.includes(".spec.")) score -= 20;
      if (filename.endsWith(".d.ts"))                         score -= 15;

      // Query-specific boost: route/page files for "how does X work" queries
      if (msgLower.includes("how") || msgLower.includes("why") || msgLower.includes("what")) {
        if (filename.includes("route") || filename.includes("page")) score += 5;
      }

      // Conversation history relevance
      const pathLower = c.path.toLowerCase();
      if (historyMentioned.has(pathLower)) {
        score += 20;
      } else {
        for (const mentioned of historyMentioned) {
          if (pathLower.includes(mentioned) || mentioned.includes(filename)) {
            score += 10;
            break;
          }
        }
      }

      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Context budget ───────────────────────────────────────

/**
 * Trim a ranked candidate list to fit within hard context limits.
 * Truncates less-relevant files before the most-relevant.
 *
 * Limits: MAX_FILES=4 · MAX_CHARS_FILE=6,000 · MAX_CHARS_TOTAL=20,000
 */
function applyContextBudget(
  ranked: RankedCandidate[]
): Array<{ path: string; content: string; truncated: boolean }> {
  const result: Array<{ path: string; content: string; truncated: boolean }> = [];
  let totalChars = 0;

  for (const file of ranked) {
    if (result.length >= BUDGET.MAX_FILES) break;
    if (totalChars >= BUDGET.MAX_CHARS_TOTAL) break;

    const remaining = BUDGET.MAX_CHARS_TOTAL - totalChars;
    const maxChars  = Math.min(BUDGET.MAX_CHARS_FILE, remaining);

    // Don't inject a file if the remaining budget is too small to be useful
    if (maxChars < 200) break;

    const content   = file.content.slice(0, maxChars);
    const truncated = file.content.length > maxChars || file.truncated;

    result.push({ path: file.path, content, truncated });
    totalChars += content.length;
  }

  return result;
}

// ─── Public entry point ───────────────────────────────────

/**
 * Build multi-file repository context for a user message.
 *
 * Full pipeline:
 *   1. Extract code references from message
 *   2. Fetch GitHub OAuth token via Clerk
 *   3. Fetch repo tree (usually a cache hit)
 *   4. Search tree for candidate paths
 *   5. Fetch seed files concurrently
 *   6. Expand to import neighbours (1 hop, using already-fetched content)
 *   7. Rank all candidates
 *   8. Apply context budget
 *   9. Emit telemetry
 *
 * Returns `null` if: no code refs found, GitHub not connected, tree fetch
 * fails, or no files match. Never throws.
 *
 * @param message  — The user's current message
 * @param ctx      — Repository context (fullName, defaultBranch, etc.)
 * @param userId   — Clerk user ID (used to retrieve GitHub token server-side)
 * @param history  — Recent conversation turns for relevance scoring
 */
export async function buildRetrievalContext(
  message:      string,
  ctx:          RepoContextInput,
  userId:       string,
  history:      RetrievalTurn[] = [],
  /**
   * Pre-fetched GitHub OAuth token from the route handler.
   * If provided, skips the Clerk round-trip — eliminates redundant token fetches
   * when multiple retrieval functions are called in the same request.
   * If omitted (or undefined), falls back to fetching from Clerk internally.
   */
  preloadedToken?: string
): Promise<CodeContext | null> {
  const t0 = Date.now();

  // ── 1. Extract code references ────────────────────────────
  const refs = extractCodeRefs(message);
  if (!refs.length) return null;

  // ── 2. GitHub OAuth token ─────────────────────────────────
  // Use pre-loaded token if provided by the route handler (eliminates duplicate
  // Clerk round-trips when multiple retrieval functions run per request).
  let githubToken: string | undefined = preloadedToken;
  if (!githubToken) {
    try {
      const client = await clerkClient();
      const tokens = await client.users.getUserOauthAccessToken(userId, "github");
      githubToken  = tokens.data[0]?.token;
    } catch {
      return null; // GitHub not connected — graceful degradation
    }
  }
  if (!githubToken) return null;

  // ── 3. Parse owner/repo ───────────────────────────────────
  const [owner, repo] = ctx.fullName.split("/");
  if (!owner || !repo) return null;

  const branch = ctx.defaultBranch ?? "main";

  // ── 4. Fetch tree (almost always a cache hit within a session) ──
  let tree: RepoTree;
  try {
    tree = await fetchRepoTree(owner, repo, branch, githubToken);
  } catch (err) {
    console.log(
      `[repo] tree_fetch_failed owner=${owner} repo=${repo} ` +
      `err=${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  // ── 5a. Folder listing path (paths-only, no content fetch) ──
  // When the highest-priority ref is a folder query, return a directory listing
  // instead of fetching file contents. Costs ~500 tokens vs the 20KB file budget,
  // and correctly answers structural questions ("what's in /api?") from real paths.
  const topRef = refs[0]!;
  if (topRef.isFolder) {
    const folderPaths = listFolderContents(tree, topRef.query);
    if (folderPaths.length > 0) {
      console.log(
        `[repo] folder_listing prefix=${topRef.query} files=${folderPaths.length}`
      );
      return {
        files:         [],
        folderListing: folderPaths,
        folderPrefix:  topRef.query,
        retrievalStatus: "folder_listed",
        treeQuery:     topRef.query,
      };
    }
    // Folder not found in tree — fall through to normal file search
    // (the query might be a file name that looks like a path)
    console.log(`[repo] folder_listing prefix=${topRef.query} result=empty — falling through to file search`);
  }

  // ── 5b. Inventory keyword search (cross-repo, paths-only, no content fetch) ──
  // When the query is an inventory question ("what auth files are in our repo?"),
  // search ALL tree nodes for the keyword anywhere in their path.
  // Returns up to 50 paths — answers listing questions without hitting the file budget.
  if (topRef.isInventory) {
    const keywordPaths = searchTreeByKeyword(tree, topRef.query);
    if (keywordPaths.length > 0) {
      console.log(
        `[repo] keyword_search query=${topRef.query} files=${keywordPaths.length}`
      );
      return {
        files:           [],
        folderListing:   keywordPaths,
        folderPrefix:    topRef.query,
        searchMode:      "keyword",
        retrievalStatus: "folder_listed",
        treeQuery:       topRef.query,
      };
    }
    // No matches for keyword — fall through to normal retrieval
    // (lets NATURAL_LANGUAGE_PATTERN handle it as a content fetch instead)
    console.log(`[repo] keyword_search query=${topRef.query} result=empty — falling through to file search`);
  }

  // ── 5. Search for candidate paths ────────────────────────
  const primaryQuery = topRef.query;
  console.log(`[repo] search_start query=${primaryQuery} refs=${refs.length}`);

  const matchedPaths = new Set<string>();
  const searchScores = new Map<string, number>();

  for (const ref of refs) {
    const matches = searchTree(tree, ref.query, 4);
    for (const m of matches) {
      if (!matchedPaths.has(m.path)) {
        matchedPaths.add(m.path);
        searchScores.set(m.path, ref.priority);
      }
      if (matchedPaths.size >= 4) break;
    }
    if (matchedPaths.size >= 4) break;
  }

  if (!matchedPaths.size) {
    console.log(`[repo] search_results top=none refs=${refs.map((r) => r.query).join(",")}`);
    return null;
  }

  // FIX (T1.3): was slice(0, 3) — raised to BUDGET.MAX_FILES (4) so the full
  // search budget is used before import expansion. Previously the 4th match was
  // silently dropped here, then import expansion only recovered it by accident.
  const topPaths = [...matchedPaths].slice(0, BUDGET.MAX_FILES);
  console.log(`[repo] search_results top=${topPaths.join(",")}`);

  // ── 6. Fetch seed files concurrently ─────────────────────
  // Track visited paths for circular-import guard and dedup
  const visitedPaths = new Set<string>(topPaths);

  const seedResults = await Promise.allSettled(
    topPaths.map((p) => fetchFileContent(owner, repo, p, githubToken!, undefined))
  );

  const seedFiles: Candidate[] = seedResults
    .map((result, i) => {
      if (result.status === "rejected") {
        console.log(`[repo] seed_fetch_failed path=${topPaths[i]} err=${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`);
        return null;
      }
      const f = result.value;
      return {
        path:        f.path,
        content:     f.content,
        truncated:   f.truncated,
        searchScore: searchScores.get(topPaths[i]!) ?? 50,
        hops:        0
      } satisfies Candidate;
    })
    .filter((f): f is Candidate => f !== null);

  if (!seedFiles.length) return null;

  // ── 7. Import graph expansion (1 hop) ────────────────────
  // Only expand if there's budget headroom beyond the seed files
  let allCandidates: Candidate[] = [...seedFiles];

  if (seedFiles.length < BUDGET.MAX_FILES) {
    try {
      const expanded = await expandImports(
        seedFiles.map((f) => ({ path: f.path, content: f.content })),
        tree,
        owner,
        repo,
        githubToken,
        visitedPaths
      );
      allCandidates = [...allCandidates, ...expanded];
    } catch {
      // Import expansion is best-effort — never fail the whole pipeline
    }
  }

  // ── 8. Rank candidates ────────────────────────────────────
  const ranked = rankCandidates(allCandidates, message, history);
  console.log(
    `[repo] retrieval_ranked ` +
    `files=[${ranked.map((f) => f.path).join(",")}] ` +
    `scores=[${ranked.map((f) => f.score).join(",")}]`
  );

  // ── 9. Apply context budget ───────────────────────────────
  const budgeted   = applyContextBudget(ranked);
  const totalChars = budgeted.reduce((sum, f) => sum + f.content.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);

  console.log(`[repo] context_budget total_chars=${totalChars} max=${BUDGET.MAX_CHARS_TOTAL} files=${budgeted.length}`);
  console.log(`[repo] files_injected paths=[${budgeted.map((f) => f.path).join(",")}] chars_each=[${budgeted.map((f) => f.content.length).join(",")}]`);
  console.log(`[repo] injected_tokens estimated=${estimatedTokens}`);
  console.log(`[repo] retrieval_ms total=${Date.now() - t0}ms`);

  if (!budgeted.length) return null;

  return {
    files:           budgeted,
    treeQuery:       primaryQuery,
    retrievalStatus: "files_retrieved",
  };
}
