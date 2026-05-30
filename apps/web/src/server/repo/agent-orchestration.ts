/**
 * Agent Orchestration — V# control plane for explicit module dispatch.
 *
 * V# is the ONLY interface users talk to. This module gives V# the ability to
 * RUN intelligence modules (not just retrieve their stored findings), to detect
 * explicit module-control intents in a message, and to present a discovery
 * roster — all without the user needing to understand Atlas/Cipher/Sentinel/
 * Pulse/Forge as separate technical systems.
 *
 * Design (locked):
 *   • One front door: users address V#. Modules are visible only as named,
 *     attributed provenance + opt-in vocabulary — never separate commands.
 *   • Asymmetric spend policy: Atlas is free + deterministic → auto-runs.
 *     Cipher / Sentinel / Pulse make paid AI calls → confirm-before-spend.
 *   • Stateless confirm handshake: the server holds no pending-action state
 *     between turns, so a paid run requires the confirm phrase to CARRY the
 *     target file path (e.g. "confirm cipher apps/web/src/foo.ts").
 *
 * This module is PURE and import-safe (types + agent-registry only) so it can
 * be unit-tested without a DB / Clerk. The impure dispatch (calling analyzers,
 * decrypting keys, hitting Clerk) lives in apps/web/src/app/api/orchestrate.
 */

import { getAgentConfig } from "@/server/repo/agent-registry";
import type { Capability } from "@/server/repo/capability-map";
import type { ArchitectureGraph, SystemNode, SystemTier } from "@/server/repo/architecture-wire";
import type { AgentId, ArchitectureTree, CipherFinding } from "@/types/intelligence";

// ─── Action model ─────────────────────────────────────────────

/** File-scoped paid modules V# can dispatch against a single referenced file. */
export type PaidAgentId = "cipher" | "sentinel" | "pulse";

const PAID_AGENTS: readonly PaidAgentId[] = ["cipher", "sentinel", "pulse"];

/**
 * Atlas presents the SAME underlying structural model through different lenses,
 * so the response materially differs by what the user actually asked for:
 *   • topology     — "map this repo": the folder/domain shape + path stats.
 *   • architecture — "analyze architecture": how it's wired (critical files,
 *                    layers, pressure) — the default, richest lens.
 *   • capability   — "understand this repo": what it DOES (Authentication,
 *                    Messaging, …) as evidence-based capability nodes.
 *
 * Freshness is intentionally NOT a fourth lens — it's orthogonal. A refresh
 * forces a fresh run and is annotated onto whichever lens was requested.
 *
 *   • graph        — "show the architecture graph": the system relationship
 *                    map (nodes + typed, confidence-labelled edges). Rendered
 *                    visually in the workspace canvas; summarized in chat.
 */
export type AtlasLens = "topology" | "architecture" | "capability" | "graph";

/**
 * What V# should do when an explicit module-control intent is detected.
 * `null` (returned from detectOrchestrationAction) means "no orchestration
 * intent — fall through to the normal retrieval + AI pipeline".
 */
export type OrchestrationAction =
  | { kind: "discover" }
  | { kind: "run-atlas"; lens: AtlasLens; refresh: boolean }
  | { kind: "run-paid"; agentId: PaidAgentId; filePath: string }
  | { kind: "confirm-paid"; agentId: PaidAgentId; filePath: string | null };

// ─── Intent patterns ──────────────────────────────────────────

/** "What can you analyze?" — list the roster. Never spends. */
const DISCOVER_PATTERNS: readonly string[] = [
  "what agents are available",
  "what agents do you have",
  "which agents",
  "list agents",
  "list the agents",
  "available agents",
  "what modules are available",
  "what modules do you have",
  "available modules",
  "list modules",
  "what can you analyze",
  "what can you analyse",
  "show me the agents",
  "what intelligence modules",
];

/** Explicit "run Atlas" intents. Free + deterministic → auto-runs. */
const ATLAS_RUN_PATTERNS: readonly string[] = [
  "run atlas",
  "use atlas",
  "ask atlas",
  "analyze architecture",
  "analyse architecture",
  "analyze the architecture",
  "analyse the architecture",
  "architecture analysis",
  "map the repository",
  "map the repo",
  "map this repo",
  "map this repository",
  "show architecture",
  "show me the architecture",
  "understand this repo",
  "understand the repo",
  "understand this repository",
  // capability-intent phrasings → Atlas capability lens
  "what does this repo do",
  "what does this app do",
  "what does this codebase do",
  "what can this repo do",
  "what are the capabilities",
  "capabilities of this repo",
  "what features",
  // graph-intent phrasings → Atlas graph lens
  "architecture graph",
  "show architecture graph",
  "show me the architecture graph",
  "show the graph",
  "show me the graph",
  "relationship graph",
  "system graph",
  "architecture map",
  "system map",
  "how systems connect",
  "how do systems connect",
  "show connections",
  "show the wiring",
];

/**
 * Graph-lens signals — the user wants the system RELATIONSHIP map (nodes +
 * edges), not the folder shape. Checked before topology so "architecture map"
 * routes to the graph rather than the folder map.
 */
const GRAPH_LENS_RE = /\bgraph\b|\bwir(e|ed|es|ing)\b|\brelationship|\bconnect(s|ions|ed)?\b|\b(system|architecture|service)\s+map\b/;

/** Capability-lens signals — the user wants to know what the repo DOES. */
const CAPABILITY_LENS_RE = /\bunderstand\b|\bcapabilit|\bfeatures?\b|what (does|can) (this|the|it)/;

/** Topology-lens signals — the user wants the folder/structure shape. */
const TOPOLOGY_LENS_RE = /\bmap\b|\btopolog|\bfolders?\b|\bdirector|\blayout\b|file (tree|structure)|\bstructure\b/;

/** A control verb must accompany a paid module name to avoid false positives. */
const PAID_VERB_RE = /\b(use|run|ask|analy[sz]e|with|invoke|call|confirm)\b/;

/** Confirm signal for the stateless spend handshake. */
const CONFIRM_RE = /\b(confirm|confirmed|proceed|go ahead|yes)\b/;

/** Refresh signal — forces a fresh Atlas run instead of serving cache. */
const REFRESH_RE = /\b(refresh|re-?run|rerun|again|fresh|re-?analy[sz]e)\b/;

// ─── Detection ────────────────────────────────────────────────

/**
 * Detect an explicit module-control intent in a user message.
 *
 * Precedence: discovery → paid dispatch → Atlas. Paid is checked before Atlas
 * so a message naming a paid module wins (it must be gated by confirm-before-
 * spend), and Atlas's free auto-run never front-runs a paid confirmation.
 *
 * Pure, allocation-light, safe to call on every message.
 */
export function detectOrchestrationAction(rawMessage: string): OrchestrationAction | null {
  const msg = rawMessage.toLowerCase();

  // 1. Discovery — highest priority, never spends.
  if (DISCOVER_PATTERNS.some((p) => msg.includes(p))) {
    return { kind: "discover" };
  }

  // 2. Paid module dispatch (cipher / sentinel / pulse).
  //    A control verb is required so prose like "the pulse of the feed" or
  //    "a sentinel value" does NOT trigger a paid run.
  const paidAgent = detectPaidAgent(msg);
  if (paidAgent) {
    const filePath = extractFilePath(rawMessage);
    if (CONFIRM_RE.test(msg) && filePath) {
      return { kind: "run-paid", agentId: paidAgent, filePath };
    }
    return { kind: "confirm-paid", agentId: paidAgent, filePath };
  }

  // 3. Atlas — free + deterministic, auto-runs. Intent picks the lens.
  if (ATLAS_RUN_PATTERNS.some((p) => msg.includes(p))) {
    return { kind: "run-atlas", lens: detectAtlasLens(msg), refresh: REFRESH_RE.test(msg) };
  }

  return null;
}

/**
 * Map an Atlas-run message to its lens. Capability intent wins over topology
 * (a "what does this repo do" question is about capabilities, even if it says
 * "repo"); everything else defaults to the richest architecture lens.
 */
function detectAtlasLens(lowerMsg: string): AtlasLens {
  // Graph wins over topology: "architecture map" / "system map" mean the
  // relationship graph, not the folder map.
  if (GRAPH_LENS_RE.test(lowerMsg))      return "graph";
  if (CAPABILITY_LENS_RE.test(lowerMsg)) return "capability";
  if (TOPOLOGY_LENS_RE.test(lowerMsg))   return "topology";
  return "architecture";
}

/** Find a named paid module in the message, gated on a control verb. */
function detectPaidAgent(lowerMsg: string): PaidAgentId | null {
  if (!PAID_VERB_RE.test(lowerMsg)) return null;
  for (const agent of PAID_AGENTS) {
    if (new RegExp(`\\b${agent}\\b`).test(lowerMsg)) return agent;
  }
  return null;
}

/**
 * Extract a repository file path from a message. Prefers a path with a
 * directory separator and an extension; falls back to a bare filename.
 * Returns null when no path-like token is present.
 */
export function extractFilePath(raw: string): string | null {
  const withSlash = raw.match(/[\w.@/-]*\/[\w.@/-]*\.[a-zA-Z]{1,6}\b/);
  if (withSlash) return withSlash[0];
  const bare = raw.match(/\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rb|rs|java|kt|sql|json|ya?ml|md)\b/);
  return bare ? bare[0] : null;
}

// ─── Formatters (pure, V# voice) ──────────────────────────────

/** Module display order for user-facing output: structure first, plan last. */
const ROSTER_ORDER: readonly AgentId[] = ["atlas", "cipher", "sentinel", "pulse", "forge"];

/**
 * The agent-discovery roster. Framed so the user understands they never call
 * these directly — they ask in plain language and V# routes.
 */
export function formatAgentRoster(): string {
  const lines: string[] = [
    "I analyze your code through a few internal intelligence modules. " +
      "You don't call these directly — just ask in plain language and I route to the right one:",
    "",
  ];
  for (const id of ROSTER_ORDER) {
    const c = getAgentConfig(id);
    const cost = c.requiresAI ? "paid AI call" : "free · instant";
    lines.push(`- **${c.displayName}** — ${c.description} _(${c.scope}-level · ${cost})_`);
  }
  lines.push("");
  lines.push(
    'Try: _"map this repo"_, _"is this file safe?"_, _"why is this slow?"_, or _"what should I fix first?"_'
  );
  return lines.join("\n");
}

/**
 * The confirm-before-spend preview for a paid module. When no file is named,
 * it asks for one; when a file is present, it shows the exact confirm phrase
 * (the stateless handshake carries the path so the next turn can run it).
 */
export function formatPaidConfirmation(agentId: PaidAgentId, filePath: string | null): string {
  const c = getAgentConfig(agentId);
  const what = c.description.charAt(0).toLowerCase() + c.description.slice(1);

  if (!filePath) {
    return (
      `**${c.displayName}** inspects a single file for ${what}. ` +
      `Running it makes a paid AI call against your OpenRouter key, so I confirm before spending.\n\n` +
      `Tell me which file to analyze, for example:\n\n` +
      `> confirm ${agentId} apps/web/src/example.ts`
    );
  }

  return (
    `Ready to run **${c.displayName}** on \`${filePath}\` — ${what}.\n\n` +
    `This makes one paid AI call against your OpenRouter key. Results are cached, ` +
    `so asking again later is free. To proceed, reply:\n\n` +
    `> confirm ${agentId} ${filePath}`
  );
}

const CONFIDENCE_LABEL: Record<CipherFinding["confidence"], string> = {
  confirmed:   "confirmed",
  inferred:    "inferred",
  speculative: "speculative",
};

const PRESSURE_LABEL: Record<ArchitectureTree["domains"][number]["pressure"], string> = {
  heavy:  "heavy",
  medium: "medium",
  light:  "light",
};

/** Provenance suffix — keeps V# honest about whether it just did work. */
function atlasProvenance(fromCache: boolean, refresh: boolean): string {
  if (refresh)   return "_(structural · free · freshly re-analyzed)_";
  return fromCache
    ? "_(structural · free · from stored analysis)_"
    : "_(structural · free · freshly analyzed)_";
}

function atlasTruncationNote(truncated: boolean): string[] {
  return truncated
    ? ["", "_Note: this repository is large enough that GitHub truncated the tree — coverage may be partial._"]
    : [];
}

function emptyArchitecture(): string {
  return (
    "**Atlas — Repository Architecture**\n\n" +
    "I couldn't derive a clear architecture from this repository — it has too few " +
    "recognizable domains (it may use a non-standard layout). Point me at a specific " +
    "file or directory and I'll dig in from there."
  );
}

/**
 * Render an Atlas result through the requested lens. The three lenses project
 * the SAME underlying model differently, so output differs materially by intent.
 */
export function formatAtlasResult(args: {
  lens: AtlasLens;
  refresh: boolean;
  architectureTree: ArchitectureTree | null;
  findings: CipherFinding[];
  capabilities: Capability[];
  totalPaths: number;
  truncated: boolean;
  fromCache: boolean;
  /** Relationship graph (Increment A+B) — required for the "graph" lens. */
  graph?: ArchitectureGraph;
}): string {
  const { lens, refresh, architectureTree, findings, capabilities, totalPaths, truncated, fromCache, graph } = args;
  const hasDomains = !!architectureTree && architectureTree.domains.length > 0;

  // Capability + graph lenses answer from their own models even when the domain
  // shape is thin, so they run before the domain guard.
  if (lens === "capability") {
    return renderCapabilityLens(capabilities, totalPaths, truncated, fromCache, refresh);
  }
  if (lens === "graph") {
    return renderGraphLens(graph, totalPaths, truncated, fromCache, refresh);
  }
  if (!hasDomains) return emptyArchitecture();
  if (lens === "topology") {
    return renderTopologyLens(architectureTree!, totalPaths, truncated, fromCache, refresh);
  }
  return renderArchitectureLens(architectureTree!, findings, capabilities, totalPaths, truncated, fromCache, refresh);
}

// Tier display order + labels for the graph lens (matches the canvas).
const GRAPH_TIER_ORDER: readonly SystemTier[] = ["entry", "domain", "data", "infra"];
const GRAPH_TIER_LABEL: Record<SystemTier, string> = {
  entry: "Entry",
  domain: "Domain",
  data: "Data",
  infra: "Infrastructure",
};

/**
 * GRAPH — the system relationship map as deterministic markdown: tiered nodes
 * with confidence + file count, then typed, confidence-labelled edges. The
 * interactive canvas lives in the Architecture Workspace; this is the chat view.
 */
function renderGraphLens(
  graph: ArchitectureGraph | undefined,
  totalPaths: number,
  truncated: boolean,
  fromCache: boolean,
  refresh: boolean
): string {
  if (!graph || graph.nodes.length === 0) {
    return (
      `**Atlas — Architecture Graph** ${atlasProvenance(fromCache, refresh)}\n\n` +
      `I couldn't derive a system graph from path + dependency signals alone ` +
      `(the repo may use a non-standard layout, or I couldn't read its package.json). ` +
      `Ask _"map this repo"_ for its folder shape instead.`
    );
  }

  const lines: string[] = [
    `**Atlas — Architecture Graph** ${atlasProvenance(fromCache, refresh)}`,
    "",
    `**${graph.nodes.length}** systems · **${graph.edges.length}** relationships ` +
      `— from **${totalPaths}** paths + declared dependencies (no file contents read).`,
  ];

  // Nodes grouped by tier.
  const byTier = new Map<SystemTier, SystemNode[]>();
  for (const n of graph.nodes) {
    const bucket = byTier.get(n.tier) ?? [];
    bucket.push(n);
    byTier.set(n.tier, bucket);
  }
  for (const tier of GRAPH_TIER_ORDER) {
    const group = byTier.get(tier);
    if (!group || group.length === 0) continue;
    lines.push("", `**${GRAPH_TIER_LABEL[tier]} layer**`);
    for (const n of group) {
      const count = n.fileCount > 0
        ? `${n.fileCount} file${n.fileCount === 1 ? "" : "s"}`
        : "dependency-only";
      lines.push(`- **${n.name}** · ${CONFIDENCE_LABEL[n.confidence]} · ${count}`);
    }
  }

  // Edges — directed, typed, confidence-labelled.
  if (graph.edges.length > 0) {
    lines.push("", "**Relationships**");
    for (const e of graph.edges) {
      const ev = e.evidence.length > 0 ? ` (${e.evidence.join(", ")})` : "";
      lines.push(`- ${e.from} → ${e.to} · _${e.type}_ · ${CONFIDENCE_LABEL[e.confidence]}${ev}`);
    }
  }

  lines.push(...atlasTruncationNote(truncated));
  lines.push("");
  lines.push("_Open the **Architecture Workspace** for the interactive canvas — click any system or relationship to inspect its evidence._");
  return lines.join("\n");
}

/** TOPOLOGY — the folder/domain shape and path statistics. */
function renderTopologyLens(
  tree: ArchitectureTree,
  totalPaths: number,
  truncated: boolean,
  fromCache: boolean,
  refresh: boolean
): string {
  const lines: string[] = [
    `**Atlas — Repository Topology** ${atlasProvenance(fromCache, refresh)}`,
    "",
    `Atlas can see all **${totalPaths}** paths in this repository (files + directories).`,
    "",
    `**Folder domains (${tree.domains.length})**`,
  ];
  for (const d of tree.domains) {
    lines.push(`- \`${d.prefix}\` — ${d.fileCount} file${d.fileCount === 1 ? "" : "s"} · ${PRESSURE_LABEL[d.pressure]} pressure`);
  }
  lines.push(...atlasTruncationNote(truncated));
  lines.push("");
  lines.push('This is the structural shape. Ask _"analyze the architecture"_ for how it\'s wired, or _"what does this repo do?"_ for capabilities.');
  return lines.join("\n");
}

/** ARCHITECTURE — how the repo is wired: critical files, layers, pressure. */
function renderArchitectureLens(
  tree: ArchitectureTree,
  findings: CipherFinding[],
  capabilities: Capability[],
  totalPaths: number,
  truncated: boolean,
  fromCache: boolean,
  refresh: boolean
): string {
  const lines: string[] = [
    `**Atlas — Repository Architecture** ${atlasProvenance(fromCache, refresh)}`,
    "",
    `Derived from **${totalPaths}** paths across **${tree.domains.length}** domains.`,
  ];

  if (findings.length > 0) {
    lines.push("");
    lines.push("**Structural findings**");
    for (const f of findings) {
      lines.push(`- [${CONFIDENCE_LABEL[f.confidence]}] **${f.title}** — ${f.description}`);
    }
  }

  if (capabilities.length > 0) {
    const names = capabilities.slice(0, 6).map((c) => c.name).join(", ");
    lines.push("");
    lines.push(`**Capabilities detected:** ${names}${capabilities.length > 6 ? ", …" : ""}`);
    lines.push('_Ask "what does this repo do?" to expand these with evidence._');
  }

  lines.push(...atlasTruncationNote(truncated));
  lines.push("");
  lines.push('Ask _"what should I fix first?"_ to turn this into a prioritized plan.');
  return lines.join("\n");
}

/** CAPABILITY — what the repo DOES, as evidence-based capability nodes. */
function renderCapabilityLens(
  capabilities: Capability[],
  totalPaths: number,
  truncated: boolean,
  fromCache: boolean,
  refresh: boolean
): string {
  if (capabilities.length === 0) {
    return (
      `**Atlas — Repository Capabilities** ${atlasProvenance(fromCache, refresh)}\n\n` +
      `I scanned all **${totalPaths}** paths but couldn't infer clear capabilities from path ` +
      `signals alone. The repo may use non-standard naming. Ask _"map this repo"_ to see its ` +
      `structure, or point me at a feature directory.`
    );
  }

  const lines: string[] = [
    `**Atlas — Repository Capabilities** ${atlasProvenance(fromCache, refresh)}`,
    "",
    `Inferred from **${totalPaths}** observable paths — path signals only, no file contents read:`,
    "",
  ];

  for (const cap of capabilities) {
    lines.push(`**${cap.name}** · ${CONFIDENCE_LABEL[cap.confidence]}`);
    for (const ev of cap.evidence) {
      lines.push(`  - ${ev}`);
    }
  }

  lines.push(...atlasTruncationNote(truncated));
  lines.push("");
  lines.push("_Confidence reflects signal strength: **confirmed** = a dedicated path/file exists; **inferred** = multiple related paths; **speculative** = a single weak signal._");
  return lines.join("\n");
}

/**
 * Render a paid file-analysis result (Cipher / Sentinel / Pulse). `fromCache`
 * makes clear when results were served from a prior run (no spend) versus a
 * fresh analysis, keeping the confirm-before-spend contract honest.
 */
export function formatPaidResult(
  displayName: string,
  filePath: string,
  findings: CipherFinding[],
  fromCache: boolean
): string {
  const provenance = fromCache ? "from stored analysis" : "freshly analyzed";

  if (findings.length === 0) {
    return (
      `**${displayName}** — \`${filePath}\` _(${provenance})_\n\n` +
      `No notable findings. Nothing stood out in this file from ${displayName}'s perspective.`
    );
  }

  const lines: string[] = [`**${displayName}** — \`${filePath}\` _(${provenance})_`, ""];
  for (const f of findings) {
    const where = f.evidenceLines ? ` _(lines ${f.evidenceLines.start}–${f.evidenceLines.end})_` : "";
    lines.push(`- [${CONFIDENCE_LABEL[f.confidence]}] **${f.title}**${where} — ${f.description}`);
  }
  return lines.join("\n");
}
