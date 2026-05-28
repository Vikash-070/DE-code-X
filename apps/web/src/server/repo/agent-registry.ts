/**
 * Agent Registry — single source of truth for intelligence modules.
 *
 * Every module that can be dispatched by V# or the orchestration route
 * is listed here. Adding a new module requires:
 *   1. Implement IntelligenceModule (or the file-level analyze function)
 *   2. Add an AgentConfig entry to AGENT_REGISTRY
 *   3. Add the agentId to the AgentId union in types/intelligence.ts
 *   4. Write tests for the module (see __tests__/agent-registry.test.ts)
 *   5. Add V# routing intent patterns below
 *
 * See CONTRIBUTING.md for the full new-module guide.
 *
 * SECURITY: This registry does not hold API keys. All provider configs
 * are resolved at call time by the API route from encrypted UserProviderKey.
 */

import type { AgentId } from "@/types/intelligence";

// ─── Registry types ───────────────────────────────────────────

export interface AgentConfig {
  /** Stable module identifier. Must match AgentId union. */
  agentId:     AgentId;
  /** Human-readable name shown in the UI. */
  displayName: string;
  /** One-line description of what this module analyses. */
  description: string;
  /** Whether this module analyses individual files (file) or the whole repo (repo). */
  scope:       "file" | "repo";
  /** Whether this module requires an AI provider call (AI calls cost API quota). */
  requiresAI:  boolean;
  /**
   * Natural-language intent patterns that trigger V# to delegate to this module.
   * V# uses these for intent matching — not regex, just string hints for the model.
   */
  intentPatterns: string[];
}

// ─── Registry ─────────────────────────────────────────────────

export const AGENT_REGISTRY: Record<AgentId, AgentConfig> = {
  cipher: {
    agentId:     "cipher",
    displayName: "Cipher",
    description: "Code quality, structure, and implementation patterns",
    scope:       "file",
    requiresAI:  true,
    intentPatterns: [
      "how is this implemented",
      "code quality",
      "code structure",
      "implementation pattern",
      "complexity",
      "dependencies",
      "how does this file work",
      "what does this code do",
    ],
  },

  sentinel: {
    agentId:     "sentinel",
    displayName: "Sentinel",
    description: "Security signals and observable vulnerability patterns",
    scope:       "file",
    requiresAI:  true,
    intentPatterns: [
      "security",
      "vulnerability",
      "injection",
      "authentication",
      "authorization",
      "secrets",
      "credentials",
      "owasp",
      "insecure",
      "attack surface",
      "is this safe",
    ],
  },

  pulse: {
    agentId:     "pulse",
    displayName: "Pulse",
    description: "Performance patterns, N+1 queries, blocking I/O, hotspots",
    scope:       "file",
    requiresAI:  true,
    intentPatterns: [
      "performance",
      "slow",
      "n+1",
      "query optimization",
      "blocking",
      "memory",
      "hotspot",
      "bottleneck",
      "speed",
      "latency",
      "caching",
    ],
  },

  atlas: {
    agentId:     "atlas",
    displayName: "Atlas",
    description: "Repository architecture — domain distribution, missing layers, structural signals",
    scope:       "repo",
    requiresAI:  false,
    intentPatterns: [
      "architecture",
      "repo structure",
      "domain",
      "layers",
      "how is this repo organized",
      "what modules exist",
      "codebase map",
      "file organization",
      "project structure",
    ],
  },

  forge: {
    agentId:     "forge",
    displayName: "Forge",
    description: "Implementation roadmap from aggregated findings",
    scope:       "repo",
    requiresAI:  true,
    intentPatterns: [
      "what should i fix first",
      "implementation plan",
      "roadmap",
      "prioritize",
      "what to work on",
      "next steps",
      "where to start",
      "action items",
    ],
  },
};

// ─── Lookup helpers ───────────────────────────────────────────

/** Get config for a specific agent. Throws if agentId is unregistered. */
export function getAgentConfig(agentId: AgentId): AgentConfig {
  const config = AGENT_REGISTRY[agentId];
  if (!config) {
    throw new Error(`[agent-registry] Unknown agentId: "${agentId}". Update AGENT_REGISTRY.`);
  }
  return config;
}

/** Get all registered agent IDs. */
export function getAllAgentIds(): AgentId[] {
  return Object.keys(AGENT_REGISTRY) as AgentId[];
}

/** Get all file-scoped modules (can be dispatched per-file). */
export function getFileAgents(): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter(a => a.scope === "file");
}

/** Get all repo-scoped modules (operate on the whole tree). */
export function getRepoAgents(): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter(a => a.scope === "repo");
}

/**
 * Match a user intent string to the most relevant module.
 * Uses simple substring matching against intentPatterns.
 * Returns null if no module matches — V# should handle it directly.
 *
 * For V# delegation: use this to decide whether to delegate or answer inline.
 */
export function matchIntentToAgent(userMessage: string): AgentConfig | null {
  const lower = userMessage.toLowerCase();

  let bestMatch: AgentConfig | null = null;
  let bestScore = 0;

  for (const config of Object.values(AGENT_REGISTRY)) {
    let score = 0;
    for (const pattern of config.intentPatterns) {
      if (lower.includes(pattern.toLowerCase())) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = config;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}
