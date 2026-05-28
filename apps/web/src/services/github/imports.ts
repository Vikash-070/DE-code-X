/**
 * Static import parser for JavaScript/TypeScript source files.
 *
 * Extracts relative module specifiers from ESM static import/export statements
 * so the retrieval pipeline can expand a seed file to its immediate import
 * graph neighbors without making extra API calls.
 *
 * ─── Supported ────────────────────────────────────────────
 *   import foo from './bar'
 *   import { foo, bar } from '../baz'
 *   import * as foo from './qux'
 *   export { foo } from './other'
 *   export * from './other'
 *   import './side-effect'
 *
 * ─── Intentionally excluded ───────────────────────────────
 *   require('./foo')         — CJS (runtime semantics differ)
 *   import('./foo')          — dynamic imports (resolved at runtime)
 *   import foo from '@/bar'  — path aliases (need tsconfig to resolve)
 *   import foo from 'react'  — bare module specifiers (external packages)
 */

// ─── Regex patterns ───────────────────────────────────────

/**
 * Matches ESM static import/export ... from 'specifier'
 * Captures the specifier only when it starts with ./ or ../
 */
const IMPORT_FROM_RE =
  /(?:^|\n)\s*(?:import|export)\b[^'";\n]*?\bfrom\s+['"](\.[^'"]+)['"]/gm;

/**
 * Matches bare side-effect imports: import './foo'
 */
const IMPORT_SIDE_EFFECT_RE =
  /(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/gm;

// ─── Extension resolution order ───────────────────────────

const SOURCE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"
] as const;

// ─── Path helpers ─────────────────────────────────────────

/**
 * Portable path resolution — avoids Node.js `path` module dependency.
 * Handles `.` and `..` segments. Does NOT handle absolute paths.
 */
function normalizePath(raw: string): string {
  const parts = raw.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== "." && part !== "") {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

/**
 * Resolve a relative import specifier against the importing file's directory.
 *
 * @param fromFilePath  — Full tree path of the importing file
 *                        (e.g. "apps/web/src/services/github/retrieval.ts")
 * @param specifier     — The raw import specifier (e.g. "../../lib/prisma")
 * @returns             — Joined, normalised path without trailing slash
 */
function resolveSpecifier(fromFilePath: string, specifier: string): string {
  const fromDir = fromFilePath.includes("/")
    ? fromFilePath.slice(0, fromFilePath.lastIndexOf("/"))
    : "";
  const joined = fromDir ? `${fromDir}/${specifier}` : specifier;
  return normalizePath(joined);
}

// ─── Public API ───────────────────────────────────────────

/**
 * Extract all relative import specifiers from a source file's content.
 *
 * Returns raw specifier strings (e.g. `"./bar"`, `"../lib/prisma"`).
 * Deduplicates — a specifier that appears multiple times is returned once.
 *
 * @param content — Full text content of the source file
 * @returns       — Array of unique relative import specifiers
 */
export function parseImports(content: string): string[] {
  const specifiers: string[] = [];
  const seen = new Set<string>();

  const add = (s: string) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      specifiers.push(s);
    }
  };

  for (const match of content.matchAll(IMPORT_FROM_RE)) {
    add(match[1]!);
  }
  for (const match of content.matchAll(IMPORT_SIDE_EFFECT_RE)) {
    add(match[1]!);
  }

  return specifiers;
}

/**
 * Resolve a relative import specifier to a real path in the repository tree.
 *
 * Tries, in order:
 *   1. Exact match (specifier already has an extension)
 *   2. Specifier + each source extension (.ts, .tsx, .js, .jsx, …)
 *   3. Specifier as a directory + /index + each source extension
 *
 * Returns `null` if no matching path is found in `treePaths`.
 *
 * @param treePaths     — Array of all valid file paths from the repo tree
 * @param specifier     — Raw relative import specifier from the source file
 * @param fromFilePath  — Full tree path of the importing file
 */
export function resolveTreePath(
  treePaths: string[],
  specifier:    string,
  fromFilePath: string
): string | null {
  const base = resolveSpecifier(fromFilePath, specifier);

  // 1. Exact match — specifier had an extension already
  if (treePaths.includes(base)) return base;

  // 2. Specifier without extension — try common source extensions
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = base + ext;
    if (treePaths.includes(candidate)) return candidate;
  }

  // 3. Treat as directory — try /index.<ext>
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = `${base}/index${ext}`;
    if (treePaths.includes(candidate)) return candidate;
  }

  return null;
}
