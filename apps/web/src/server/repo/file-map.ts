/**
 * File Map — deterministic file-level classification (Stage 1).
 *
 * Maps EVERY repository file to an architectural layer + role from path and
 * filename signals alone. No AI, no content reads, no embeddings — every
 * classification is a directly-readable, explainable rule over the path.
 *
 * This is the file-level counterpart to the system-level Relationship Engine
 * (architecture-wire.ts). It powers the "Files" view of the architecture canvas
 * — the reference-style layered columns of real files. Stage 2 (import scan)
 * attaches call edges to these file nodes; Stage 3 attaches AI narration.
 *
 * PURE and import-safe (type-only GitHubTreeNode import) → unit-testable.
 */

import type { GitHubTreeNode } from "@/services/github/tree";

// ─── Types ────────────────────────────────────────────────────

/** Architectural layer — becomes a column on the canvas. */
export type FileLayer =
  | "client-entry"
  | "context-guards"
  | "feature-pages"
  | "frontend-services"
  | "api-middleware"
  | "backend-modules"
  | "data-schema"
  | "shared"
  | "config"
  | "tests"
  | "other";

/** Fine-grained role — the node's sub-label. */
export type FileRole =
  | "entry" | "provider" | "guard" | "page" | "component" | "hook"
  | "frontend-service" | "server-entry" | "route" | "middleware"
  | "controller" | "backend-service" | "model" | "schema" | "migration"
  | "config" | "util" | "type" | "style" | "test" | "doc" | "other";

export interface FileNode {
  path: string;
  name: string;
  layer: FileLayer;
  role: FileRole;
  /** Blob size in bytes (0 when unknown). */
  size: number;
}

export interface FileMap {
  files: FileNode[];
  /** Files grouped by layer, in FILE_LAYER_ORDER (some buckets may be empty). */
  byLayer: Record<FileLayer, FileNode[]>;
  totalFiles: number;
}

/** Column order (left→right) + display labels for the canvas. */
export const FILE_LAYER_ORDER: readonly FileLayer[] = [
  "client-entry", "context-guards", "feature-pages", "frontend-services",
  "api-middleware", "backend-modules", "data-schema", "shared", "config",
  "tests", "other",
];

export const FILE_LAYER_LABEL: Record<FileLayer, string> = {
  "client-entry":      "Client Entry",
  "context-guards":    "Context / Guards",
  "feature-pages":     "Feature Pages",
  "frontend-services": "Frontend Services",
  "api-middleware":    "API / Middleware",
  "backend-modules":   "Backend Modules",
  "data-schema":       "Data / Schema",
  "shared":            "Components / Shared",
  "config":            "Config / Tooling",
  "tests":             "Tests",
  "other":             "Other",
};

// ─── Vendor / build exclusion ─────────────────────────────────

const VENDOR_SEGMENTS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".turbo",
  ".cache", "coverage", "__pycache__", "vendor", "venv", ".venv", "target",
]);

function isVendorPath(lowerPath: string): boolean {
  for (const seg of lowerPath.split("/")) if (VENDOR_SEGMENTS.has(seg)) return true;
  return false;
}

// ─── Classifier ───────────────────────────────────────────────

/**
 * Classify a single file path into a layer + role. Ordered rules — first match
 * wins — so more specific signals (tests, config, routes) win over generic
 * fallbacks (component, util). Deterministic and explainable.
 */
export function classifyFile(rawPath: string): { layer: FileLayer; role: FileRole } {
  const path = rawPath.toLowerCase();
  const segs = path.split("/");
  const file = segs[segs.length - 1] ?? path;
  const dot = file.lastIndexOf(".");
  const ext = dot >= 0 ? file.slice(dot + 1) : "";
  const base = dot >= 0 ? file.slice(0, dot) : file;
  const has = (s: string) => path.includes(s);
  const inSeg = (s: string) => segs.includes(s);

  const isTsx = ext === "tsx" || ext === "jsx";
  const isTs  = ext === "ts" || ext === "js" || ext === "mjs" || ext === "cjs" || isTsx;
  const isBackendCtx =
    has("/server/") || has("backend/") || has("/api/") || inSeg("modules") ||
    has("/functions/") || has("/handlers/") || has("/controllers/");

  // 1. Tests
  if (inSeg("__tests__") || inSeg("__mocks__") || /\.(test|spec)\./.test(file)) {
    return { layer: "tests", role: "test" };
  }
  // 2. Config / tooling
  if (
    /^(package\.json|tsconfig.*\.json|.*\.config\.[mc]?[jt]s|tailwind\.config\..+|postcss\.config\..+|\.eslintrc.*|\.prettierrc.*|next-env\.d\.ts|dockerfile|docker-compose\..+|vercel\.json|turbo\.json|\.env(\..+)?)$/.test(file)
  ) {
    return { layer: "config", role: "config" };
  }
  // 3. Data / schema
  if (file === "schema.prisma") return { layer: "data-schema", role: "schema" };
  if (ext === "sql" || inSeg("migrations") || inSeg("migration")) {
    return { layer: "data-schema", role: "migration" };
  }
  // 4. Styles / docs / types
  if (["css", "scss", "sass", "less"].includes(ext)) return { layer: "shared", role: "style" };
  if (["md", "mdx"].includes(ext))                    return { layer: "shared", role: "doc" };
  if (file.endsWith(".d.ts") || base === "types" || inSeg("types")) {
    return { layer: "shared", role: "type" };
  }

  // 5. Client entry (frontend only)
  if (isTsx && !isBackendCtx && ["app", "_app", "_document", "main", "root", "index"].includes(base)) {
    return { layer: "client-entry", role: "entry" };
  }
  if (["appinitializer", "bootstrap", "serviceworker", "sw", "registerserviceworker"].includes(base)) {
    return { layer: "client-entry", role: "entry" };
  }

  // 6. Context / guards
  if (base.endsWith("context") || base.endsWith("provider") || inSeg("providers")) {
    return { layer: "context-guards", role: "provider" };
  }
  if (base.includes("guard") || base.includes("protectedroute") || (base.includes("protected") && base.includes("route"))) {
    return { layer: "context-guards", role: "guard" };
  }

  // 7. API / middleware
  if (base === "middleware") return { layer: "api-middleware", role: "middleware" };
  if (/\.routes?$/.test(base) || base === "route" || inSeg("routes")) {
    return { layer: "api-middleware", role: "route" };
  }
  if (base === "server" || (base === "index" && has("/server"))) {
    return { layer: "api-middleware", role: "server-entry" };
  }

  // 8. Backend modules
  if (base.endsWith("controller")) return { layer: "backend-modules", role: "controller" };

  // 9. Services / clients / hooks (front vs back by context)
  if (base.endsWith("service") || base.endsWith(".service")) {
    return isBackendCtx
      ? { layer: "backend-modules", role: "backend-service" }
      : { layer: "frontend-services", role: "frontend-service" };
  }
  if (base.endsWith("client")) return { layer: "frontend-services", role: "frontend-service" };
  if (/^use[a-z0-9]/.test(base) && isTs && !isBackendCtx) {
    return { layer: "frontend-services", role: "hook" };
  }

  // 10. Pages
  if (["page", "layout", "loading", "error", "template"].includes(base)) {
    return { layer: "feature-pages", role: "page" };
  }
  if ((inSeg("pages") || base.endsWith("page")) && isTsx) {
    return { layer: "feature-pages", role: "page" };
  }

  // 11. Models / entities
  if (base.endsWith("model") || base.endsWith("entity") || base.endsWith("schema")) {
    return { layer: "data-schema", role: "model" };
  }

  // 12. Generic backend code
  if (isTs && isBackendCtx) return { layer: "backend-modules", role: "backend-service" };

  // 13. Components
  if (inSeg("components") || isTsx) return { layer: "shared", role: "component" };

  // 14. Utils / lib
  if (inSeg("lib") || inSeg("utils") || /(^|-)(util|utils|helper|helpers)$/.test(base)) {
    return { layer: "shared", role: "util" };
  }

  // 15. Fallbacks
  if (isTs) return { layer: "shared", role: "util" };
  return { layer: "other", role: "other" };
}

// ─── Build ────────────────────────────────────────────────────

/**
 * Build the full file map from the repository tree. Pass `rawNodes` for 100%
 * coverage. Directories and vendor/build paths are excluded. O(n) — one
 * classification per file.
 */
export function buildFileMap(nodes: readonly GitHubTreeNode[]): FileMap {
  const files: FileNode[] = [];

  for (const n of nodes) {
    if (n.type === "tree") continue;
    if (isVendorPath(n.path.toLowerCase())) continue;
    const { layer, role } = classifyFile(n.path);
    files.push({
      path: n.path,
      name: n.path.split("/").pop() ?? n.path,
      layer,
      role,
      size: n.size ?? 0,
    });
  }

  // Deterministic order: by layer rank, then path.
  const rank = (l: FileLayer) => FILE_LAYER_ORDER.indexOf(l);
  files.sort((a, b) => rank(a.layer) - rank(b.layer) || a.path.localeCompare(b.path));

  const byLayer = {} as Record<FileLayer, FileNode[]>;
  for (const l of FILE_LAYER_ORDER) byLayer[l] = [];
  for (const f of files) byLayer[f.layer].push(f);

  return { files, byLayer, totalFiles: files.length };
}
