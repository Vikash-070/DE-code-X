/**
 * Atlas Relationship Engine — deterministic architecture graph.
 *
 * Atlas's folder/capability map answers "what exists." This module answers
 * "how it's wired": it projects the repository into a graph of SYSTEM NODES
 * (Authentication, Messaging, Database…) connected by TYPED, DIRECTED EDGES.
 *
 * No AI. No embeddings. No content crawl. Every node and edge is derived from
 * directly-readable, deterministic signals and is fully auditable.
 *
 * ── SCOPE: Increment A + B ──────────────────────────────────────────────
 *   A. System nodes + tiers — reuses deriveCapabilities() (path signals).
 *      Each capability becomes a SystemNode placed on a layout tier
 *      (entry → domain → data → infra) so the graph renders as a layered
 *      canvas rather than a hairball.
 *
 *   B. External-dependency edges — from a SINGLE file: package.json.
 *      A curated package→system table maps installed dependencies to systems
 *      (clerk→Authentication, stripe→Payments, prisma→Database, …). Each
 *      backed system gets a `depends-on`/`data-flow` edge from the application
 *      entry hub. This gives a meaningful graph at the cost of one file read.
 *
 * ── DEFERRED: Increment C (the anchor scan) ─────────────────────────────
 *   Internal import edges (Messaging→Realtime, API→Database) require a bounded
 *   read of anchor files' imports. That is the only part that adds I/O and is
 *   intentionally NOT in this module. When it lands, it appends `SystemEdge`s
 *   with structured per-line evidence; the types here are forward-compatible.
 *
 * This module is PURE and import-safe (type-only GitHubTreeNode import) so it
 * unit-tests without a DB / GitHub and is callable from Atlas + the route.
 */

import { deriveCapabilities, type CapabilityConfidence } from "@/server/repo/capability-map";
import type { GitHubTreeNode } from "@/services/github/tree";

// ─── Graph types (render-agnostic) ───────────────────────────

/** Layout rank — drives left→right / top→bottom layering on the canvas. */
export type SystemTier = "entry" | "domain" | "data" | "infra";

/**
 * Typed, directed relationship. Direction encodes flow so the canvas can show
 * "where requests flow" vs "where data flows" without reading code.
 *   • depends-on   — A uses B (generic dependency).
 *   • request-flow — a route/entry hands a request to a system. (Increment C)
 *   • data-flow    — a system reads/writes a data store.
 *   • guards       — auth/middleware protects routes. (Increment C)
 *   • triggers     — a system fires another (e.g. Messaging→Notifications). (C)
 */
export type EdgeType = "depends-on" | "request-flow" | "data-flow" | "guards" | "triggers";

/** Reused confidence vocabulary — identical to capability confidence. */
export type Confidence = CapabilityConfidence;

export interface SystemNode {
  /** Stable identity = canonical system name. Survives re-runs → stable layout. */
  id: string;
  name: string;
  tier: SystemTier;
  confidence: Confidence;
  /** Contributing path count (0 when the node exists only via a dependency). */
  fileCount: number;
  /** Bounded sample of contributing paths (≤4) for auditability. */
  evidencePaths: string[];
  /** External packages that back this system (Increment B). */
  dependencies: string[];
}

export interface SystemEdge {
  /** Deterministic identity: `${from}->${to}:${type}`. */
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  /** Strength — edge thickness on the canvas (here: count of backing signals). */
  weight: number;
  confidence: Confidence;
  /**
   * Human-readable evidence lines, e.g. "via `@clerk/nextjs`". Increment C will
   * add file:line-grounded entries; rendering stays the same (a string list).
   */
  evidence: string[];
}

export interface ArchitectureGraph {
  nodes: SystemNode[];
  edges: SystemEdge[];
  /** FNV-1a over the sorted graph — cache / incremental-update key. */
  fingerprint: string;
  /** True when the source tree was truncated (coverage may be partial). */
  truncated: boolean;
}

/** Per-node adjacency projection for rendering — your "ArchitectureWire". */
export interface ArchitectureWire {
  node: SystemNode;
  out: SystemEdge[];
  in: SystemEdge[];
}

// ─── Synthetic entry hub ──────────────────────────────────────

/** Used as the edge source when no detected "API Layer" entry node exists. */
const APPLICATION_NODE = "Application";

// ─── Tier rules ───────────────────────────────────────────────

const TIER_BY_SYSTEM: Readonly<Record<string, SystemTier>> = {
  "API Layer":               "entry",
  [APPLICATION_NODE]:        "entry",
  "Database & Migrations":   "data",
  "Realtime":                "infra",
  "Background Jobs":         "infra",
  "AI / Intelligence":       "infra",
  "Authentication":          "domain",
  "Messaging":               "domain",
  "Notifications":           "domain",
  "Uploads":                 "domain",
  "Search":                  "domain",
  "Payments":                "domain",
  "Feed":                    "domain",
};

function tierFor(system: string): SystemTier {
  return TIER_BY_SYSTEM[system] ?? "domain";
}

const TIER_RANK: Readonly<Record<SystemTier, number>> = {
  entry: 0, domain: 1, data: 2, infra: 3,
};

// ─── Package → system table (Increment B) ─────────────────────
// Curated, tight to avoid false positives. Tested against the LOWERCASED
// package name. System names MUST match capability names so dependency-backed
// nodes merge with path-derived nodes. Extend by adding a pattern.

interface PackageRule {
  system: string;
  match: RegExp[];
}

const PACKAGE_RULES: readonly PackageRule[] = [
  { system: "Authentication",        match: [/^@?clerk(\/|$)/, /^next-auth$/, /^@auth\//, /^passport(-|$)/, /^@supabase\/auth/, /firebase.*auth/, /^@aws-amplify\/auth$/, /^@workos/, /auth0/] },
  { system: "Payments",              match: [/^stripe$/, /^@stripe\//, /^braintree/, /^@paddle/, /lemonsqueezy/, /^@paypal/, /^razorpay$/] },
  { system: "Database & Migrations", match: [/^@prisma\/client$/, /^prisma$/, /^drizzle-orm$/, /^typeorm$/, /^sequelize$/, /^mongoose$/, /^pg$/, /^mysql2?$/, /^better-sqlite3$/, /^@supabase\/supabase-js$/, /^knex$/, /^kysely$/, /^mongodb$/] },
  { system: "Realtime",              match: [/^socket\.io(-|$)/, /^ws$/, /^pusher(-|$)/, /^ably$/, /^@supabase\/realtime/, /^ioredis$/, /^redis$/, /^@upstash\/redis$/, /partykit/] },
  { system: "Search",                match: [/^algoliasearch$/, /^@algolia\//, /^meilisearch$/, /^typesense$/, /^@elastic\//, /elasticsearch/, /^@orama\//] },
  { system: "Background Jobs",       match: [/^bullmq$/, /^bull$/, /^agenda$/, /^bee-queue$/, /^@temporalio\//, /graphile-worker/, /^@trigger\.dev\//, /^inngest$/] },
  { system: "AI / Intelligence",     match: [/^openai$/, /^@anthropic-ai\//, /^@ai-sdk\//, /^ai$/, /langchain/, /^cohere-ai$/, /^@google\/generative-ai$/, /^@mistralai\//, /^groq-sdk$/, /^replicate$/] },
  { system: "Uploads",               match: [/^multer$/, /^@aws-sdk\/client-s3$/, /^aws-sdk$/, /cloudinary/, /^@uploadthing(\/|$)/, /^busboy$/, /^formidable$/, /^@vercel\/blob$/] },
  { system: "Notifications",         match: [/^twilio$/, /^@sendgrid\//, /^nodemailer$/, /^resend$/, /^@react-email\//, /^web-push$/, /^@novu\//, /^firebase-admin$/, /onesignal/] },
  { system: "API Layer",             match: [/^express$/, /^fastify$/, /^@hapi\//, /^koa$/, /^@nestjs\//, /^next$/, /^hono$/, /^@trpc\//, /apollo-server/, /^graphql$/] },
];

function mapPackageToSystem(pkg: string): string | null {
  const lower = pkg.toLowerCase();
  for (const rule of PACKAGE_RULES) {
    if (rule.match.some((re) => re.test(lower))) return rule.system;
  }
  return null;
}

// ─── package.json helper (the route reads the file; this parses it) ──

/**
 * Extract dependency names from raw package.json text. Merges every dependency
 * bucket (runtime + dev + peer + optional) — all are architecture signal.
 * Defensive: returns [] on malformed JSON. Pure → unit-testable.
 */
export function parsePackageDependencies(packageJsonText: string): string[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(packageJsonText) as Record<string, unknown>;
  } catch {
    return [];
  }
  const buckets = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const names = new Set<string>();
  for (const bucket of buckets) {
    const obj = pkg[bucket];
    if (obj && typeof obj === "object") {
      for (const name of Object.keys(obj as Record<string, unknown>)) names.add(name);
    }
  }
  return [...names];
}

// ─── Node derivation (Increment A + B enrichment) ────────────

/**
 * Build system nodes from path capabilities (A) and enrich with / create from
 * external dependencies (B). A dependency is directly-readable evidence, so it
 * confirms a system even when no matching path exists yet.
 */
export function deriveSystemNodes(
  nodes: readonly GitHubTreeNode[],
  dependencies: readonly string[] = []
): SystemNode[] {
  const byName = new Map<string, SystemNode>();

  // A — path capabilities become nodes.
  for (const cap of deriveCapabilities(nodes)) {
    byName.set(cap.name, {
      id:            cap.name,
      name:          cap.name,
      tier:          tierFor(cap.name),
      confidence:    cap.confidence,
      fileCount:     cap.signalCount,
      evidencePaths: cap.paths,
      dependencies:  [],
    });
  }

  // B — dependencies confirm existing nodes or create new (infra) nodes.
  for (const dep of dependencies) {
    const system = mapPackageToSystem(dep);
    if (!system) continue;
    const existing = byName.get(system);
    if (existing) {
      if (!existing.dependencies.includes(dep)) existing.dependencies.push(dep);
      existing.confidence = "confirmed"; // a declared package is directly readable
    } else {
      byName.set(system, {
        id:            system,
        name:          system,
        tier:          tierFor(system),
        confidence:    "confirmed",
        fileCount:     0,
        evidencePaths: [],
        dependencies:  [dep],
      });
    }
  }

  return sortNodes([...byName.values()]);
}

// ─── Graph assembly ───────────────────────────────────────────

/**
 * Build the deterministic architecture graph (Increment A + B).
 *
 * @param params.nodes         repository tree nodes (prefer rawNodes).
 * @param params.dependencies  package.json dependency names (Increment B).
 * @param params.truncated     whether the source tree was truncated.
 */
export function buildArchitectureGraph(params: {
  nodes: readonly GitHubTreeNode[];
  dependencies?: readonly string[];
  truncated?: boolean;
}): ArchitectureGraph {
  const { nodes: treeNodes, dependencies = [], truncated = false } = params;
  const nodes = deriveSystemNodes(treeNodes, dependencies);
  const edges = buildDependencyEdges(nodes);

  return {
    nodes,
    edges,
    truncated,
    fingerprint: fingerprintGraph(nodes, edges),
  };
}

/**
 * Increment B edges: every externally-backed system is something the app
 * depends on, so it gets an edge from the entry hub (the detected "API Layer",
 * or a synthetic "Application" node when none exists). Data stores get a
 * `data-flow` edge; everything else `depends-on`. Self-edges are skipped.
 */
function buildDependencyEdges(nodes: SystemNode[]): SystemEdge[] {
  const backed = nodes.filter((n) => n.dependencies.length > 0);
  if (backed.length === 0) return [];

  // Choose the hub. If every backed system IS the API Layer (nothing to point
  // at), there are no edges to draw.
  const apiNode = nodes.find((n) => n.id === "API Layer");
  const hubId = apiNode ? apiNode.id : APPLICATION_NODE;

  const targets = backed.filter((n) => n.id !== hubId);
  if (targets.length === 0) return [];

  // Lazily materialize the synthetic hub only when it's actually used.
  if (!apiNode) {
    nodes.push({
      id:            APPLICATION_NODE,
      name:          APPLICATION_NODE,
      tier:          "entry",
      confidence:    "inferred",
      fileCount:     0,
      evidencePaths: [],
      dependencies:  [],
    });
    sortNodesInPlace(nodes);
  }

  const edges: SystemEdge[] = [];
  for (const target of targets) {
    const type: EdgeType = tierFor(target.id) === "data" ? "data-flow" : "depends-on";
    edges.push({
      id:         `${hubId}->${target.id}:${type}`,
      from:       hubId,
      to:         target.id,
      type,
      weight:     target.dependencies.length,
      // Dependency is confirmed; the precise source system is pinned in Increment C.
      confidence: "inferred",
      evidence:   target.dependencies.map((d) => `via \`${d}\``),
    });
  }
  return sortEdges(edges);
}

// ─── Wire projection ──────────────────────────────────────────

/** Project the graph into per-node adjacency wires for rendering. */
export function toWires(graph: ArchitectureGraph): ArchitectureWire[] {
  return graph.nodes.map((node) => ({
    node,
    out: graph.edges.filter((e) => e.from === node.id),
    in:  graph.edges.filter((e) => e.to === node.id),
  }));
}

// ─── Deterministic ordering + fingerprint ─────────────────────

function sortNodes(nodes: SystemNode[]): SystemNode[] {
  return nodes.slice().sort(compareNodes);
}
function sortNodesInPlace(nodes: SystemNode[]): void {
  nodes.sort(compareNodes);
}
function compareNodes(a: SystemNode, b: SystemNode): number {
  return (
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    b.fileCount - a.fileCount ||
    a.name.localeCompare(b.name)
  );
}

function sortEdges(edges: SystemEdge[]): SystemEdge[] {
  return edges.slice().sort((a, b) =>
    b.weight - a.weight ||
    a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to) ||
    a.type.localeCompare(b.type)
  );
}

/** Content-insensitive structural hash of the graph (FNV-1a, 32-bit). */
function fingerprintGraph(nodes: SystemNode[], edges: SystemEdge[]): string {
  const nodePart = nodes
    .map((n) => `${n.id}|${n.tier}|${n.confidence}|${n.dependencies.slice().sort().join(",")}`)
    .join(";");
  const edgePart = edges
    .map((e) => `${e.id}|${e.weight}|${e.confidence}`)
    .join(";");
  return fnv1a(`${nodePart}#${edgePart}`);
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
