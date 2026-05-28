/**
 * GitHub file content retrieval service.
 *
 * Fetches the decoded content of a single source file using the
 * GitHub Contents API. Results are cached in-process with a 5-minute TTL.
 *
 * SECURITY: Token is server-side only. Content is truncated at MAX_CONTENT_CHARS
 * to prevent oversized payloads reaching AI providers.
 *
 * PERFORMANCE: Binary and oversized files are rejected before decoding.
 */

// ─── Constants ────────────────────────────────────────────

/** Maximum bytes we'll fetch from a single file. GitHub base64-encodes content
 *  so the actual response body is ~33% larger. */
const MAX_FILE_BYTES = 150_000; // ~150 KB raw

/** Maximum characters we inject into AI context from a single file. */
export const MAX_CONTENT_CHARS = 8_000;

// ─── Cache ────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry {
  content:   string;
  size:      number;
  truncated: boolean;
  expiry:    number;
}

const fileCache = new Map<string, CacheEntry>();

function fileCacheKey(owner: string, repo: string, path: string, ref?: string): string {
  return `${owner}/${repo}:${path}${ref ? `@${ref}` : ""}`;
}

function getFileCached(key: string): CacheEntry | null {
  const entry = fileCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    fileCache.delete(key);
    return null;
  }
  return entry;
}

function setFileCached(key: string, data: Omit<CacheEntry, "expiry">): void {
  fileCache.set(key, { ...data, expiry: Date.now() + CACHE_TTL_MS });
}

// ─── GitHub Contents API response ────────────────────────

interface GitHubContentsResponse {
  type:     "file" | "dir" | "symlink" | "submodule";
  encoding: "base64" | "none" | "";
  size:     number;
  name:     string;
  path:     string;
  content:  string;
  sha:      string;
}

// ─── Helpers ─────────────────────────────────────────────

/** Detect whether a decoded string looks like binary content. */
function looksLikeBinary(text: string): boolean {
  // Count null bytes and control chars (excluding common whitespace)
  let controlCount = 0;
  const sample = text.slice(0, 512);
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    if (code === 0 || (code < 9) || (code >= 14 && code < 32)) {
      controlCount++;
    }
  }
  return controlCount > sample.length * 0.05; // > 5% control chars → binary
}

// ─── Public API ───────────────────────────────────────────

export interface FetchedFile {
  path:      string;
  content:   string;
  size:      number;       // raw file size in bytes
  truncated: boolean;      // true if content was cut at MAX_CONTENT_CHARS
  sha:       string;
}

/**
 * Fetch the decoded text content of a single file from a GitHub repository.
 *
 * @param owner  - GitHub user/org login
 * @param repo   - Repository name
 * @param path   - File path within the repository (e.g. "src/app/page.tsx")
 * @param token  - GitHub OAuth token (server-side only)
 * @param ref    - Optional commit SHA or branch name (defaults to repo default branch)
 * @returns Decoded file content (UTF-8), truncated at MAX_CONTENT_CHARS
 */
export async function fetchFileContent(
  owner:  string,
  repo:   string,
  path:   string,
  token:  string,
  ref?:   string
): Promise<FetchedFile> {
  const key = fileCacheKey(owner, repo, path, ref);
  const cached = getFileCached(key);
  if (cached) {
    console.log(`[file] cache_hit path=${path} size=${cached.size}`);
    return {
      path,
      content:   cached.content,
      size:      cached.size,
      truncated: cached.truncated,
      sha:       key // cached — sha not stored, use key as surrogate
    };
  }

  console.log(`[file] fetch_start owner=${owner} repo=${repo} path=${path}`);

  const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const url      = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${refParam}`;

  const response = await fetch(url, {
    headers: {
      Authorization:          `Bearer ${token}`,
      Accept:                 "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub Contents API ${response.status} for ${path}` +
      (body ? `: ${body.slice(0, 120)}` : "")
    );
  }

  const data = (await response.json()) as GitHubContentsResponse;

  // Only handle files (not directories or submodules)
  if (data.type !== "file") {
    throw new Error(`${path} is a ${data.type}, not a file`);
  }

  // Reject files that are too large to be useful
  if (data.size > MAX_FILE_BYTES) {
    throw new Error(
      `File ${path} is ${Math.round(data.size / 1024)}KB — too large for context injection (limit: ${Math.round(MAX_FILE_BYTES / 1024)}KB)`
    );
  }

  // Decode base64 content
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding "${data.encoding}" for ${path}`);
  }

  // Node.js Buffer.from() handles base64; content may contain newlines (GitHub wraps at 60 chars)
  const decoded = Buffer.from(data.content, "base64").toString("utf-8");

  if (looksLikeBinary(decoded)) {
    throw new Error(`${path} appears to be a binary file — skipping`);
  }

  const truncated = decoded.length > MAX_CONTENT_CHARS;
  const content   = truncated ? decoded.slice(0, MAX_CONTENT_CHARS) : decoded;

  console.log(
    `[file] fetch_complete path=${path} raw=${data.size}b decoded=${decoded.length}ch truncated=${truncated}`
  );

  const entry: Omit<CacheEntry, "expiry"> = {
    content,
    size:      data.size,
    truncated
  };
  setFileCached(key, entry);

  return { path, content, size: data.size, truncated, sha: data.sha };
}

/**
 * Invalidate a cached file entry.
 * Call after a push event or when the user indicates file has changed.
 */
export function invalidateFileCache(
  owner:  string,
  repo:   string,
  path:   string,
  ref?:   string
): void {
  fileCache.delete(fileCacheKey(owner, repo, path, ref));
}
