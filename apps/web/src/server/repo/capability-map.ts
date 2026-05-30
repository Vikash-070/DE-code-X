/**
 * Capability Map — evidence-based capability inference for Atlas.
 *
 * Atlas's job is to surface what a repository DOES (Authentication, Messaging,
 * Uploads…) — not the folders it happens to use (src/components, src/pages).
 * This module derives capability nodes from observable PATH signals over the
 * full repository tree. It never reads file content, so it stays deterministic,
 * inspectable, and cheap — exactly Atlas's mandate (no AI, no embeddings, no
 * dependency crawler).
 *
 * HONEST SCOPE: "evidence" here means observable path/filename signals, not
 * semantic proof. Every capability carries a confidence label and the concrete
 * paths it was inferred from, so the inference is always auditable:
 *   • confirmed   — a dedicated directory segment or critical filename exists
 *                   (the path is directly readable, not guessed).
 *   • inferred    — multiple weaker path signals point at the capability.
 *   • speculative — a single weak signal; may be a false positive.
 *
 * This module is PURE and import-safe (type-only imports) so it can be unit
 * tested without a DB and imported by both Atlas and the orchestration layer.
 */

import type { GitHubTreeNode } from "@/services/github/tree";

// ─── Types ────────────────────────────────────────────────────

export type CapabilityConfidence = "confirmed" | "inferred" | "speculative";

export interface Capability {
  /** Human-facing capability name, e.g. "Authentication". */
  name: string;
  /** How strongly the path evidence supports this capability. */
  confidence: CapabilityConfidence;
  /** Human-readable evidence lines — what was observed, with examples. */
  evidence: string[];
  /** Bounded sample of contributing paths (≤4) for auditability. */
  paths: string[];
  /** Total number of distinct contributing paths (strong + weak). */
  signalCount: number;
}

// ─── Rule set ─────────────────────────────────────────────────

interface CapabilityRule {
  name: string;
  /** Strong signals — a dedicated directory segment or distinctive filename. */
  strong: RegExp[];
  /** Weak signals — keyword appears somewhere in the path. */
  weak: RegExp[];
}

/**
 * Ordered capability rules. Generic enough for any web/app repo, intentionally
 * tight to avoid false positives. Extend by adding a rule — no other change
 * needed. Tested against the LOWERCASED full path.
 */
const CAPABILITY_RULES: readonly CapabilityRule[] = [
  {
    name: "Authentication",
    strong: [/\/auth\//, /\/sign-?in\//, /\/sign-?up\//, /\/login\//, /^middleware\.[mc]?[jt]sx?$/, /\/middleware\.[mc]?[jt]sx?$/, /\bclerk\b/, /next-?auth/],
    weak:   [/auth/, /session/, /\boauth\b/, /\btoken\b/],
  },
  {
    name: "Messaging",
    strong: [/\/chat\//, /\/messages?\//, /\/conversations?\//, /\/dm\//],
    weak:   [/message/, /\bchat\b/, /\binbox\b/],
  },
  {
    name: "Notifications",
    strong: [/\/notifications?\//, /\/push\//, /\/alerts?\//],
    weak:   [/notif/, /\bpush\b/],
  },
  {
    name: "Uploads",
    strong: [/\/uploads?\//, /\/storage\//, /\/media\//, /\/attachments?\//, /signed-?url/],
    weak:   [/upload/, /\bfile-?upload\b/, /multipart/],
  },
  {
    name: "Search",
    strong: [/\/search\//, /\balgolia\b/, /elasticsearch/, /typesense/, /meilisearch/],
    weak:   [/\bsearch\b/, /\bindex(er|ing)?\b/, /\bquery\b/],
  },
  {
    name: "Realtime",
    strong: [/\/realtime\//, /\bsocket(s|\.io)?\b/, /\/ws\//, /\bpusher\b/, /\bably\b/],
    weak:   [/realtime/, /websocket/, /\bredis\b/, /subscribe/],
  },
  {
    name: "Payments",
    strong: [/\/payments?\//, /\/billing\//, /\bstripe\b/, /\/checkout\//, /\/subscriptions?\//],
    weak:   [/payment/, /\binvoice\b/, /\bpricing\b/],
  },
  {
    name: "Feed",
    strong: [/\/feed\//, /\/timeline\//],
    weak:   [/\bfeed\b/, /timeline/],
  },
  {
    name: "Database & Migrations",
    strong: [/schema\.prisma$/, /\/migrations?\//, /\/supabase\//, /\.sql$/],
    weak:   [/\bprisma\b/, /\bdatabase\b/, /\/db\//],
  },
  {
    name: "API Layer",
    strong: [/\/route\.[mc]?[jt]sx?$/, /\/api\//, /edge-?functions?/, /\/functions\//, /\/handlers?\//],
    weak:   [/\bendpoint/, /\bcontroller/],
  },
  {
    name: "AI / Intelligence",
    strong: [/\/ai\//, /\bopenai\b/, /anthropic/, /openrouter/, /\bllm\b/],
    weak:   [/embedding/, /\bagent\b/, /\bprompt\b/, /\bmodel\b/],
  },
  {
    name: "Background Jobs",
    strong: [/\/jobs?\//, /\/queues?\//, /\/workers?\//, /\bbullmq\b/, /\/cron\//],
    weak:   [/\bqueue\b/, /\bworker\b/, /\bscheduler\b/],
  },
];

// Vendor / build noise excluded from capability reasoning (we still INDEX these
// for existence, but they must not be read as application capabilities).
const VENDOR_SEGMENTS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".turbo",
  ".cache", "coverage", "__pycache__", "vendor", "venv", ".venv", "target",
]);

function isVendorPath(lowerPath: string): boolean {
  for (const seg of lowerPath.split("/")) {
    if (VENDOR_SEGMENTS.has(seg)) return true;
  }
  return false;
}

// ─── Derivation ───────────────────────────────────────────────

/**
 * Derive capability nodes from the repository's full path set.
 *
 * Pass `tree.rawNodes` (100% of paths) for complete visibility; falls back
 * gracefully to the filtered `nodes` set. Pure and O(n · rules) — a handful of
 * regex tests per path, microseconds for typical repos.
 *
 * @param nodes  Repository tree nodes (prefer rawNodes for full visibility).
 * @returns Capabilities sorted by signal strength (most-evidenced first).
 */
export function deriveCapabilities(nodes: readonly GitHubTreeNode[]): Capability[] {
  const out: Capability[] = [];

  for (const rule of CAPABILITY_RULES) {
    const strongPaths: string[] = [];
    const weakPaths:   string[] = [];

    for (const node of nodes) {
      const lower = node.path.toLowerCase();
      if (isVendorPath(lower)) continue;

      if (rule.strong.some((re) => re.test(lower))) {
        strongPaths.push(node.path);
      } else if (rule.weak.some((re) => re.test(lower))) {
        weakPaths.push(node.path);
      }
    }

    const signalCount = strongPaths.length + weakPaths.length;
    if (signalCount === 0) continue;

    const confidence: CapabilityConfidence =
      strongPaths.length > 0 ? "confirmed" :
      weakPaths.length >= 2  ? "inferred"  :
                               "speculative";

    out.push({
      name:        rule.name,
      confidence,
      evidence:    buildEvidence(strongPaths, weakPaths),
      paths:       [...strongPaths, ...weakPaths].slice(0, 4),
      signalCount,
    });
  }

  // Most-evidenced first; stable alphabetical tiebreak for determinism.
  return out.sort((a, b) => b.signalCount - a.signalCount || a.name.localeCompare(b.name));
}

function buildEvidence(strongPaths: string[], weakPaths: string[]): string[] {
  const ev: string[] = [];
  if (strongPaths.length > 0) {
    ev.push(
      `${strongPaths.length} dedicated path${strongPaths.length === 1 ? "" : "s"} ` +
      `(e.g. \`${strongPaths[0]}\`)`
    );
  }
  if (weakPaths.length > 0) {
    ev.push(
      `${weakPaths.length} related path${weakPaths.length === 1 ? "" : "s"} ` +
      `(e.g. \`${weakPaths[0]}\`)`
    );
  }
  return ev;
}
