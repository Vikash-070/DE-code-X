/**
 * Import Graph — Stage 2 (Increment C): deterministic file→file call wires.
 *
 * Builds the "Calls / Sends To" edges of the architecture map by reading a
 * BOUNDED set of anchor files, extracting their import/require specifiers, and
 * resolving each to a real path in the repository tree. No AI, no embeddings —
 * every edge cites the exact import line as evidence and carries a confidence
 * label, so it is fully auditable.
 *
 * COST IS BOUNDED: only `maxAnchors` files are read (high-signal layers first),
 * each parsed with a line regex (no AST). Resolution is O(1) against a path Set.
 * This is the only Atlas stage that reads file contents; it is intentionally
 * lazy (its own endpoint) so the base architecture load stays fast.
 *
 * The PARSE + RESOLVE functions are PURE (no I/O) → unit-testable. The graph
 * builder takes a `fetchContent` callback so it can be tested without GitHub.
 */

import type { FileNode, FileLayer } from "@/server/repo/file-map";

// ─── Types ────────────────────────────────────────────────────

export interface FileImportRef {
  /** The raw module specifier, e.g. "./feedService", "@/lib/db", "react". */
  spec: string;
  line: number;
  /** The trimmed source line, for evidence display. */
  raw: string;
}

export type EdgeConfidence = "confirmed" | "inferred";

export interface FileEdge {
  from: string;
  to: string;
  confidence: EdgeConfidence;
  /** Import lines in `from` that produced this edge. */
  evidence: { line: number; raw: string }[];
}

export interface ImportGraph {
  edges: FileEdge[];
  /** Files actually read + parsed. */
  scanned: number;
  /** Candidate anchors before the maxAnchors cap. */
  anchors: number;
  /** True when anchors were capped (coverage partial). */
  truncated: boolean;
}

/** A tsconfig path-alias rule, e.g. { prefix: "@/", target: "src/" }. */
export interface AliasRule {
  prefix: string;
  target: string;
}

// ─── Import parsing (pure) ────────────────────────────────────

// Specifier in a `... from "X"` clause (import or export).
const FROM_RE   = /\bfrom\s*['"]([^'"]+)['"]/;
// Side-effect import: `import "X";`
const BARE_RE   = /\bimport\s*['"]([^'"]+)['"]/;
// Dynamic import: `import("X")`
const DYN_RE    = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/;
// CommonJS: `require("X")`
const REQ_RE    = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/;

/**
 * Extract module specifiers from source text. Line-based (imports live on one
 * line in practice; multi-line imports still carry the specifier on the `from`
 * line). Deduplicated by spec, keeping the first occurrence.
 */
export function parseImports(content: string): FileImportRef[] {
  const out = new Map<string, FileImportRef>();
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("import") && !line.includes("require") && !line.includes("from")) continue;

    const spec =
      FROM_RE.exec(line)?.[1] ??
      DYN_RE.exec(line)?.[1] ??
      REQ_RE.exec(line)?.[1] ??
      (line.trimStart().startsWith("import") ? BARE_RE.exec(line)?.[1] : undefined);

    if (spec && !out.has(spec)) {
      out.set(spec, { spec, line: i + 1, raw: line.trim().slice(0, 200) });
    }
  }
  return [...out.values()];
}

// ─── tsconfig alias parsing (pure) ────────────────────────────

/**
 * Extract path-alias rules from raw tsconfig text. Tolerant of comments and
 * trailing commas (common in tsconfig). Fail-open: returns [] on any error.
 * Maps `compilerOptions.paths` against `baseUrl`, e.g. baseUrl "." +
 * "@/*": ["./src/*"]  →  { prefix: "@/", target: "src/" }.
 */
export function parseTsconfigAliases(text: string): AliasRule[] {
  let json: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
      .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments (not URLs)
      .replace(/,(\s*[}\]])/g, "$1");     // trailing commas
    json = JSON.parse(stripped);
  } catch {
    return [];
  }

  const co = json.compilerOptions;
  if (!co?.paths) return [];

  const baseUrl = normalizePath(co.baseUrl ?? ".");
  const rules: AliasRule[] = [];

  for (const [pattern, targets] of Object.entries(co.paths)) {
    const target = targets?.[0];
    if (!target) continue;
    // Only handle the common "prefix/*" → "target/*" form.
    const prefix = pattern.endsWith("/*") ? pattern.slice(0, -1) : pattern; // keep trailing "/"
    const rawTo  = target.endsWith("/*") ? target.slice(0, -1) : target;
    const resolvedTo = normalizePath(joinPath(baseUrl, rawTo));
    rules.push({ prefix, target: resolvedTo ? resolvedTo + "/" : "" });
  }
  // Longest prefix first → most specific alias wins.
  return rules.sort((a, b) => b.prefix.length - a.prefix.length);
}

// ─── Resolution (pure) ────────────────────────────────────────

const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_CANDIDATES = [
  "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs",
];

/**
 * Resolve an import specifier to a real repository path.
 *   • relative ("./", "../") → resolve against the importer's directory.
 *   • alias    ("@/…")       → rewrite via tsconfig paths, then resolve.
 *   • bare package           → null (external; handled at the system level).
 * Returns the resolved path + confidence (inferred when matched via a barrel
 * `index.*` re-export), or null when it can't be pinned to a tree path.
 */
export function resolveImport(
  fromPath: string,
  spec: string,
  pathIndex: ReadonlySet<string>,
  aliases: readonly AliasRule[]
): { path: string; confidence: EdgeConfidence } | null {
  let baseTarget: string | null = null;

  if (spec.startsWith(".")) {
    baseTarget = normalizePath(joinPath(dirname(fromPath), spec));
  } else {
    for (const a of aliases) {
      if (a.prefix && spec.startsWith(a.prefix)) {
        baseTarget = normalizePath(a.target + spec.slice(a.prefix.length));
        break;
      }
    }
  }
  if (baseTarget === null) return null; // bare package → external

  // Direct file (with extension probing).
  for (const ext of EXT_CANDIDATES) {
    const cand = baseTarget + ext;
    if (pathIndex.has(cand)) return { path: cand, confidence: "confirmed" };
  }
  // Barrel / directory index → re-export hop, lower confidence.
  for (const idx of INDEX_CANDIDATES) {
    const cand = baseTarget + idx;
    if (pathIndex.has(cand)) return { path: cand, confidence: "inferred" };
  }
  return null;
}

// ─── Path helpers (posix, pure) ───────────────────────────────

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function joinPath(base: string, rel: string): string {
  if (!base) return rel;
  if (rel.startsWith("/")) return rel.slice(1);
  return `${base}/${rel}`;
}

/** Collapse "." and ".." segments. Pure, posix-style. */
function normalizePath(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// ─── Anchor selection ─────────────────────────────────────────

/** Layers most worth scanning for wires, in priority order. */
const ANCHOR_LAYER_PRIORITY: Readonly<Record<FileLayer, number>> = {
  "client-entry": 0,
  "context-guards": 1,
  "api-middleware": 2,
  "backend-modules": 3,
  "feature-pages": 4,
  "frontend-services": 5,
  "data-schema": 6,
  "shared": 7,
  "config": 8,
  "tests": 9,
  "other": 10,
};

/** Roles that are never useful to read for call wires. */
const SKIP_ROLES = new Set(["style", "doc", "type", "config", "migration", "schema"]);

/** Pick the high-signal anchor files to scan, deterministically ordered. */
export function selectAnchors(files: readonly FileNode[], maxAnchors: number): {
  anchors: FileNode[];
  total: number;
  truncated: boolean;
} {
  const eligible = files.filter((f) => !SKIP_ROLES.has(f.role));
  const sorted = eligible.slice().sort((a, b) =>
    ANCHOR_LAYER_PRIORITY[a.layer] - ANCHOR_LAYER_PRIORITY[b.layer] ||
    a.path.localeCompare(b.path)
  );
  return {
    anchors: sorted.slice(0, maxAnchors),
    total: eligible.length,
    truncated: eligible.length > maxAnchors,
  };
}

// ─── Graph builder (I/O via injected fetchContent) ────────────

export interface BuildImportGraphParams {
  /** All files (from the file map). Anchors are selected from these. */
  files: readonly FileNode[];
  /** Every path in the repo (from rawNodes) for O(1) resolution. */
  pathIndex: ReadonlySet<string>;
  /** tsconfig alias rules. */
  aliases: readonly AliasRule[];
  /** Reads a file's text; returns null on failure (fail-open). */
  fetchContent: (path: string) => Promise<string | null>;
  /** Hard cap on files read. */
  maxAnchors?: number;
  /** Concurrent reads. */
  concurrency?: number;
}

/**
 * Build the file import graph. Reads ≤maxAnchors files, parses + resolves their
 * imports, and emits deduplicated file→file edges with evidence. Self-edges and
 * unresolved (external) imports are dropped.
 */
export async function buildImportGraph(params: BuildImportGraphParams): Promise<ImportGraph> {
  const { files, pathIndex, aliases, fetchContent } = params;
  const maxAnchors  = params.maxAnchors ?? 150;
  const concurrency = params.concurrency ?? 8;

  const { anchors, total, truncated } = selectAnchors(files, maxAnchors);

  // Accumulate edges keyed by "from to".
  const edgeMap = new Map<string, FileEdge>();
  let scanned = 0;

  for (let i = 0; i < anchors.length; i += concurrency) {
    const batch = anchors.slice(i, i + concurrency);
    const contents = await Promise.all(
      batch.map((a) => fetchContent(a.path).catch(() => null))
    );

    batch.forEach((anchor, j) => {
      const content = contents[j];
      if (content === null || content === undefined) return;
      scanned++;

      for (const imp of parseImports(content)) {
        const resolved = resolveImport(anchor.path, imp.spec, pathIndex, aliases);
        if (!resolved || resolved.path === anchor.path) continue;

        const key = `${anchor.path} ${resolved.path}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.evidence.push({ line: imp.line, raw: imp.raw });
          // Any confirmed evidence upgrades the edge.
          if (resolved.confidence === "confirmed") existing.confidence = "confirmed";
        } else {
          edgeMap.set(key, {
            from: anchor.path,
            to: resolved.path,
            confidence: resolved.confidence,
            evidence: [{ line: imp.line, raw: imp.raw }],
          });
        }
      }
    });
  }

  const edges = [...edgeMap.values()].sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
  );

  return { edges, scanned, anchors: total, truncated };
}
