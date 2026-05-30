/**
 * Architecture Workspace — shared type definitions.
 *
 * ArchitectureTreeNode is the unified wire type consumed by the frontend tree
 * renderer and produced by the backend serializer.
 *
 * Node types:
 *   root            — invisible root wrapper (never rendered directly)
 *   section         — top-level grouping ("Structural Domains", "Detected Systems")
 *   domain          — directory-based structural domain (from buildDomainMap)
 *   system          — logical system (from enrichSystemMapWithTree)
 *   evidence-file   — source file confirming a system is implemented
 *
 * Confidence levels:
 *   strong          — source-confirmed: keyword search found matching files in tree
 *   partial         — package.json only: dependency detected, no source evidence yet
 *   directory-only  — structural domain: existence inferred from directory layout only
 *
 * v1 notes:
 *   integrityScore, trustBoundaryNote, weakSeams are reserved for v2/v3.
 *   They are always null in v1 responses. Clients MUST handle null gracefully.
 */

export type NodeType =
  | "root"
  | "section"
  | "domain"
  | "system"
  | "evidence-file";

export type ConfidenceLevel =
  | "strong"           // source-confirmed via keyword search
  | "partial"          // package.json detected, no source files found
  | "directory-only";  // structural domain inferred from directory layout

export type PressureLabel =
  | "heavy"   // ≥ 20 files — core / well-developed area
  | "medium"  //  5–19 files — moderate implementation
  | "light";  //  < 5 files — thin layer or nascent feature

export interface ArchitectureTreeNode {
  /** Stable identifier for React keys and URL anchors. */
  id: string;

  /** Human-readable label rendered in the UI. */
  label: string;

  /** Node role — determines rendering strategy. */
  type: NodeType;

  /** Confidence in this node's accuracy. */
  confidence: ConfidenceLevel;

  // ── Domain-specific fields ───────────────────────────────────
  /** Implementation pressure based on file count (domain nodes only). */
  pressure?: PressureLabel;

  /** Number of files matching this domain prefix (domain nodes only). */
  fileCount?: number;

  /** Directory prefix used for detection, e.g. "src/app/api" (domain nodes only). */
  prefix?: string;

  // ── System-specific fields ───────────────────────────────────
  /** Canonical system name, e.g. "Authentication" (system nodes only). */
  systemName?: string;

  /**
   * Detected stack components from package.json, e.g. ["Clerk", "JWT"].
   * System nodes only.
   */
  components?: string[];

  /**
   * Source files whose filenames matched system keywords.
   * Present on strong-confidence systems only.
   *
   * IMPORTANT: These filenames MATCH the system's keywords, but do NOT
   * guarantee correct implementation. Evidence = signal, not proof.
   */
  evidenceFiles?: string[];

  /**
   * Shown alongside evidence files when confidence is "partial".
   * Explains that the system was detected from package.json only.
   */
  evidenceNote?: string;

  // ── Tree structure ───────────────────────────────────────────
  /** Child nodes. Undefined on leaf nodes. */
  children?: ArchitectureTreeNode[];

  // ── Persistent intelligence (v1 — populated by Cipher) ─────
  /**
   * Staleness status from the persistence layer.
   * "fresh"   — blobSHA matches last analyzed version.
   * "stale"   — one or more analyzed files changed since last scan.
   * "unknown" — no intelligence stored yet for this node.
   * Undefined on evidence-file and section nodes.
   */
  freshnessStatus?: "fresh" | "stale" | "unknown";

  /** Number of files under this node whose blobSHA changed since last analysis. */
  staleFileCount?: number;

  /** ISO 8601 timestamp of the most recent Cipher analysis attached to this node. */
  lastIntelligenceAt?: string;

  // ── v2/v3 reserved ──────────────────────────────────────────
  /**
   * Integrity score [0–100].
   * Null in v1. Reserved for v2 (import graph analysis + AST).
   */
  integrityScore: null;

  /**
   * Trust boundary annotation.
   * Null in v1. Reserved for v2 (bounded 1-hop BFS import analysis).
   */
  trustBoundaryNote: null;

  /**
   * Detected weak architectural seams.
   * Null in v1. Reserved for v3 (cross-system dependency analysis).
   */
  weakSeams: null;
}

// ── API response type ────────────────────────────────────────

import type { ArchitectureGraph } from "@/server/repo/architecture-wire";
import type { FileMap } from "@/server/repo/file-map";

/**
 * Response shape from GET /api/repo/architecture.
 */
export interface ArchitectureResponse {
  /** Flat-at-root but self-nested tree. Always 2 top-level section nodes. */
  tree: ArchitectureTreeNode[];

  /** Source of domain data. */
  domainSource: "tree-scan";

  /** Source of system data. */
  systemSource: "package-json" | "package-json+source-evidence";

  /** GitHub full name, e.g. "acme/my-app". */
  repoFullName: string;

  /** ISO 8601 timestamp of when data was generated. */
  generatedAt: string;

  /**
   * Deterministic architecture graph (Atlas Relationship Engine, Increment A+B):
   * tiered system nodes + external-dependency edges. Drives the visual canvas.
   * Absent when the repository tree could not be fetched.
   */
  architectureGraph?: ArchitectureGraph;

  /**
   * File-level map (Stage 1): every repository file classified into an
   * architectural layer + role. Drives the canvas "Files" view. Absent when
   * the repository tree could not be fetched.
   */
  fileMap?: FileMap;
}
