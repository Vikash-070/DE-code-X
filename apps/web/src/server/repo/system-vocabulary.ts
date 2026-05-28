/**
 * Canonical system vocabulary for V1 Repository System Registry.
 *
 * Rules:
 * - 8 systems maximum in v1 (token discipline)
 * - Names are canonical — never free-form, never LLM-generated
 * - status="partial" is the default for package-only evidence (v1)
 * - status="strong" requires package + evidence files (v2 — tree scan)
 * - status="missing" reserved for explicitly absent systems (v2)
 * - evidenceFiles populated in v2 via searchTree(); always empty in v1
 */

export const SYSTEM_NAMES = [
  "Authentication",
  "Database",
  "AI Orchestration",
  "Realtime Messaging",
  "File Uploads",
  "Payments",
  "Queue Systems",
  "Infrastructure/Caching",
] as const;

export type SystemName = (typeof SYSTEM_NAMES)[number];

/** Evidence strength for a detected system. */
export type SystemStatus = "strong" | "partial" | "missing";

/** A single detected engineering system in a repository. */
export interface RepoSystem {
  /** Canonical name from SYSTEM_NAMES — never free-form. */
  name:            SystemName;
  /** Confidence level. v1 always emits "partial" (package-only evidence). */
  status:          SystemStatus;
  /** Human-readable component labels e.g. ["Clerk", "JWT"]. */
  stackComponents: string[];
  /**
   * File paths used as evidence. Empty in v1.
   * Populated in v2 when searchTree() confirms active usage.
   */
  evidenceFiles:   string[];
}

/** Full system map for a repository. Persisted in in-process cache (v1). */
export interface RepositorySystemMap {
  /** GitHub full name e.g. "acme/my-app". */
  repoFullName: string;
  /** ISO timestamp of when this map was built. */
  generatedAt:  string;
  /** Detected systems — 8 max. Only "partial" or "strong" systems appear here. */
  systems:      RepoSystem[];
  /** Inferred primary stack e.g. "TypeScript / Next.js". */
  primaryStack: string;
}
