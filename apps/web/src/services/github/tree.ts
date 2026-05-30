/**
 * GitHub repository tree service.
 *
 * Fetches the full recursive file tree for a repository using the
 * GitHub Git Trees API. Results are cached in-process with a 10-minute TTL
 * to avoid redundant API calls during a session.
 *
 * SECURITY: The GitHub token never leaves the server. All callers must pass
 * a token obtained server-side via Clerk's getUserOauthAccessToken.
 *
 * PERFORMANCE: The Git Trees API returns all paths in a single response
 * (1 API call, not paginated). Filter on the server; send only paths to clients.
 */

// ─── Types ────────────────────────────────────────────────

export interface GitHubTreeNode {
  path: string;
  type: "blob" | "tree";
  sha:  string;
  size?: number;
}

export interface RepoTree {
  /**
   * Filtered source blobs — vendor/build dirs, binaries, lockfiles, and
   * oversized files removed. This is the candidate set for V# retrieval and
   * the (unchanged) input to V#'s domain-map context.
   */
  nodes:     GitHubTreeNode[];
  /**
   * 100% of repository paths, including directory (`tree`) entries and files
   * that `shouldInclude` filters out. This is ATLAS's source of truth — it lets
   * Atlas know every path exists without ever reading file content. Optional so
   * test-constructed trees and legacy callers keep working; consumers that need
   * full visibility fall back to `nodes` when absent.
   */
  rawNodes?: GitHubTreeNode[];
  /** True when GitHub truncated the recursive tree (very large monorepo). */
  truncated?: boolean;
  owner:     string;
  repo:      string;
  branch:    string;
  fetchedAt: number;
}

// ─── In-process TTL cache ─────────────────────────────────
// Key: `${owner}/${repo}@${branch}`
// Survives across requests in the same process (Next.js long-lived server).
// Cleared automatically on next access when expired.

const CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes

interface CacheEntry {
  data:   RepoTree;
  expiry: number;
}

const treeCache = new Map<string, CacheEntry>();

function cacheKey(owner: string, repo: string, branch: string): string {
  return `${owner}/${repo}@${branch}`;
}

function getCached(key: string): RepoTree | null {
  const entry = treeCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    treeCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: RepoTree): void {
  treeCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// ─── Path filtering ───────────────────────────────────────
// Skip vendor directories, build artifacts, and binary-like extensions.
// We only want source files that V# can reason about.

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  "venv",
  ".venv",
  "target",          // Rust/Java
  "bin",
  "obj"
]);

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".mp3", ".wav", ".ogg", ".webm",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".pdf", ".docx", ".xlsx",
  ".lock",           // package-lock.json, yarn.lock, Cargo.lock
  ".map"             // source maps
]);

function shouldInclude(node: GitHubTreeNode): boolean {
  if (node.type !== "blob") return false; // trees are directory entries, not files

  const parts = node.path.split("/");

  // Skip if any path segment is a known vendor/build dir
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return false;
  }

  // Skip dot-files at root (config dirs)
  const filename = parts[parts.length - 1]!;
  if (filename.startsWith(".") && !filename.startsWith(".env")) return false;

  // Skip binary/large extensions
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = filename.slice(dotIdx).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) return false;
    if (filename.endsWith(".lock")) return false;
  }

  // Skip files larger than 500KB (unlikely to be useful for context)
  if (node.size !== undefined && node.size > 512_000) return false;

  return true;
}

// ─── GitHub API ───────────────────────────────────────────

interface GitHubTreeResponse {
  sha:       string;
  url:       string;
  truncated: boolean;
  tree: Array<{
    path?: string;
    mode?: string;
    type?: string;
    sha?:  string;
    size?: number;
    url?:  string;
  }>;
}

interface GitHubRefResponse {
  object: { sha: string };
}

async function githubGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization:        `Bearer ${token}`,
      Accept:               "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    // No Next.js cache — we manage our own TTL
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub API ${response.status} on ${path}` +
      (body ? `: ${body.slice(0, 120)}` : "")
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Resolve a branch name to its HEAD commit SHA.
 * This lets us use the SHA as a stable cache key across multiple requests.
 */
async function resolveBranchSha(
  owner:  string,
  repo:   string,
  branch: string,
  token:  string
): Promise<string> {
  const ref = await githubGet<GitHubRefResponse>(
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token
  );
  return ref.object.sha;
}

// ─── Public API ───────────────────────────────────────────

/**
 * Fetch the full file tree for a repository.
 *
 * @param owner   - GitHub user/org login
 * @param repo    - Repository name
 * @param branch  - Branch name (defaults to "main")
 * @param token   - GitHub OAuth token (server-side only)
 * @returns Filtered list of source file paths with their SHAs
 */
export async function fetchRepoTree(
  owner:  string,
  repo:   string,
  branch: string,
  token:  string
): Promise<RepoTree> {
  const key = cacheKey(owner, repo, branch);
  const cached = getCached(key);
  if (cached) {
    console.log(`[repo] tree_cache_hit owner=${owner} repo=${repo} branch=${branch} nodes=${cached.nodes.length}`);
    return cached;
  }

  console.log(`[repo] tree_cache_miss owner=${owner} repo=${repo} branch=${branch}`);
  console.log(`[tree] fetch_start owner=${owner} repo=${repo} branch=${branch}`);

  // Resolve branch to SHA for a stable tree lookup
  let treeSha: string;
  try {
    treeSha = await resolveBranchSha(owner, repo, branch, token);
  } catch (err) {
    // Branch might not be "main" — fall back to using branch name directly
    console.log(`[tree] branch_resolve_failed branch=${branch} err=${err instanceof Error ? err.message : String(err)}`);
    treeSha = branch;
  }

  // Fetch the full recursive tree
  const treeResp = await githubGet<GitHubTreeResponse>(
    `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    token
  );

  if (treeResp.truncated) {
    console.log(`[tree] response_truncated owner=${owner} repo=${repo} — large monorepo, some paths may be missing`);
  }

  // Map ALL valid entries once — this is Atlas's raw source of truth (100% of
  // paths, including directories). Then derive the filtered V# view from it.
  // One GitHub call feeds both consumers; no second round-trip.
  const rawNodes: GitHubTreeNode[] = treeResp.tree
    .filter((entry): entry is Required<typeof entry> =>
      typeof entry.path === "string" &&
      typeof entry.type === "string" &&
      typeof entry.sha  === "string"
    )
    .map((entry) => ({
      path: entry.path,
      type: entry.type as "blob" | "tree",
      sha:  entry.sha,
      size: entry.size
    }));

  // Filtered source-blob view for V# retrieval (unchanged behavior).
  const nodes: GitHubTreeNode[] = rawNodes.filter(shouldInclude);

  console.log(
    `[tree] fetch_complete nodes=${nodes.length} rawNodes=${rawNodes.length} truncated=${treeResp.truncated}`
  );

  const result: RepoTree = {
    nodes,
    rawNodes,
    truncated: treeResp.truncated,
    owner,
    repo,
    branch,
    fetchedAt: Date.now()
  };

  setCached(key, result);
  return result;
}

/**
 * Search the cached tree for files matching a query string.
 * Ranks by: filename match > last path segment > full path.
 *
 * @param tree    - RepoTree returned by fetchRepoTree
 * @param query   - Search term (filename or partial path)
 * @param limit   - Max results to return (default 10)
 */
export function searchTree(
  tree:  RepoTree,
  query: string,
  limit = 10
): GitHubTreeNode[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  type Scored = { node: GitHubTreeNode; score: number };

  const scored: Scored[] = [];

  for (const node of tree.nodes) {
    const path     = node.path.toLowerCase();
    const filename = path.split("/").pop() ?? path;

    let score = 0;

    if (filename === q)                       score = 100; // exact filename match
    else if (filename.startsWith(q))          score = 80;  // filename prefix
    else if (filename.includes(q))            score = 60;  // filename contains
    else if (path.includes(`/${q}`))          score = 40;  // last segment match
    else if (path.includes(q))               score = 20;  // anywhere in path
    else continue;                                          // no match — skip

    // Boost source files
    if (filename.endsWith(".ts") || filename.endsWith(".tsx")) score += 5;
    if (filename.endsWith(".js") || filename.endsWith(".jsx")) score += 3;

    scored.push({ node, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.node);
}

/**
 * List all source files under a given folder path prefix.
 *
 * Used for directory intelligence queries: "what's in the /api folder?",
 * "show me the auth directory contents", etc.
 *
 * Returns file paths only — does NOT fetch content.
 * This lets V# answer structural questions from path evidence alone,
 * at ~500 token cost vs the 20KB budget required to fetch file contents.
 *
 * @param tree    - RepoTree returned by fetchRepoTree
 * @param prefix  - Directory prefix to search under (e.g. "src/server/ai")
 * @param limit   - Max file paths to return (default 30)
 * @returns Sorted list of matching file paths
 */
export function listFolderContents(
  tree:   RepoTree,
  prefix: string,
  limit = 30
): string[] {
  const normalized = prefix
    .replace(/^\//, "")       // strip leading slash
    .replace(/\/$/, "")       // strip trailing slash
    .toLowerCase();

  if (!normalized) return [];

  return tree.nodes
    .filter(n => n.path.toLowerCase().startsWith(normalized + "/") ||
                 n.path.toLowerCase() === normalized)
    .map(n => n.path)
    .sort()
    .slice(0, limit);
}

/**
 * Search ALL source files in the tree for a keyword appearing anywhere in the path.
 *
 * Used for inventory queries: "what auth files are in our repo?",
 * "show me all payment files", "list database files".
 *
 * Unlike searchTree() which ranks files and returns the top N for content fetch,
 * this returns ALL matching paths (up to `limit`) as a path-only listing.
 * No file content is fetched — costs ~1KB vs the 20KB file-fetch budget.
 *
 * Ranking: exact segment match > filename contains > path contains.
 *
 * @param tree    - RepoTree returned by fetchRepoTree
 * @param keyword - The keyword to search for (case-insensitive)
 * @param limit   - Max file paths to return (default 50)
 * @returns Sorted list of matching file paths
 */
export function searchTreeByKeyword(
  tree:    RepoTree,
  keyword: string,
  limit  = 50
): string[] {
  const kw = keyword.toLowerCase().trim();
  if (!kw || kw.length < 2) return [];

  type Scored = { path: string; score: number };
  const scored: Scored[] = [];

  for (const node of tree.nodes) {
    if (node.type !== "blob") continue;

    const pathLower = node.path.toLowerCase();
    const segments  = pathLower.split("/");
    const filename  = segments[segments.length - 1] ?? pathLower;
    const nameNoExt = filename.replace(/\.[^.]+$/, "");

    let score = 0;

    if (nameNoExt === kw)                  score = 100; // exact filename (no ext) match
    else if (filename.startsWith(kw))      score = 85;  // filename starts with keyword
    else if (segments.includes(kw))        score = 80;  // exact directory segment
    else if (filename.includes(kw))        score = 70;  // keyword inside filename
    else if (pathLower.includes(`/${kw}`)) score = 50;  // directory segment contains keyword
    else if (pathLower.includes(kw))       score = 30;  // anywhere in path

    if (score === 0) continue;

    // Boost TypeScript/JavaScript source files
    if (filename.endsWith(".ts") || filename.endsWith(".tsx")) score += 5;
    if (filename.endsWith(".js") || filename.endsWith(".jsx")) score += 3;

    // Slightly demote test files (still included — user may want to see them)
    if (filename.includes(".test.") || filename.includes(".spec.")) score -= 10;
    if (filename.endsWith(".d.ts"))                                  score -= 8;

    scored.push({ path: node.path, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.path);
}

/**
 * Build an O(1) path-existence index over the FULL repository tree.
 *
 * Uses rawNodes (100% of paths) when available, falling back to the filtered
 * `nodes` for legacy/test trees. Lets Atlas answer "does this path exist?"
 * without scanning the node array and without reading any file content.
 *
 * @returns A Set of every known path (files and directories).
 */
export function buildPathIndex(tree: RepoTree): Set<string> {
  const source = tree.rawNodes ?? tree.nodes;
  const index = new Set<string>();
  for (const node of source) index.add(node.path);
  return index;
}

/**
 * Invalidate the tree cache for a specific repository.
 * Call after a push event to force a fresh fetch.
 */
export function invalidateTreeCache(
  owner:  string,
  repo:   string,
  branch: string
): void {
  treeCache.delete(cacheKey(owner, repo, branch));
  console.log(`[tree] cache_invalidated owner=${owner} repo=${repo} branch=${branch}`);
}
