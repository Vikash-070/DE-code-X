"use client";

/**
 * ArchitectureTree
 *
 * Renders the full architecture tree from an ArchitectureTreeNode[].
 *
 * Handles all 5 UI states:
 *   loading  — animated skeleton (3 placeholder rows per section)
 *   success  — full tree with domains + systems sections
 *   partial  — tree with only one section; shows a banner explaining what's missing
 *   error    — error message with action hint
 *   empty    — no architectural signals found (unlikely, but valid)
 *
 * Sections (top-level nodes) are expanded by default.
 * System nodes with evidence files start collapsed (user opens on demand).
 * Domain nodes are leaves (no children to expand).
 */

import { AlertTriangle, GitBranch, Github, Info } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { ArchitectureTreeState } from "@/hooks/use-architecture-tree";
import type { ArchitectureResponse } from "@/types/architecture";
import { ArchitectureNode } from "./architecture-node";

// ─── Props ────────────────────────────────────────────────────

interface ArchitectureTreeProps {
  state: ArchitectureTreeState;
  /** Called when the user clicks a domain node — loads the intelligence panel. */
  onSelectDomain?: (domainPrefix: string) => void;
  /** Currently-selected domain prefix, for node highlight. */
  selectedPrefix?: string | null;
}

// ─── Component ────────────────────────────────────────────────

export function ArchitectureTree({ state, onSelectDomain, selectedPrefix }: ArchitectureTreeProps) {
  const { status, tree, systemSource } = state;

  // ── Loading ──────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="space-y-4" aria-label="Loading architecture…" role="status">
        <SkeletonSection label="Structural Domains" rows={4} />
        <SkeletonSection label="Detected Systems" rows={3} />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-8 text-center">
        <AlertTriangle className="h-6 w-6 text-red-400" />
        <p className="text-sm font-medium text-red-300">Failed to load architecture</p>
        <p className="max-w-xs text-xs text-zinc-500">{state.error}</p>
        <p className="text-xs text-zinc-600">
          Ensure the repository is accessible and your GitHub account is connected.
        </p>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────
  if (status === "empty") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-8 text-center">
        <Github className="h-6 w-6 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">No architectural signals found</p>
        <p className="max-w-xs text-xs text-zinc-600">
          This repository may be empty, use an unsupported language, or have no
          recognisable directory structure.
        </p>
      </div>
    );
  }

  // ── Success + Partial ─────────────────────────────────────────
  const hasDomains = tree.some(n => n.id === "section-domains");
  const hasSystems = tree.some(n => n.id === "section-systems");

  return (
    <div className="space-y-4">
      {/* Partial-data banner */}
      {status === "partial" && (
        <PartialBanner hasDomains={hasDomains} hasSystems={hasSystems} />
      )}

      {/* Evidence quality banner — shown when systems are package-only */}
      {hasSystems && systemSource === "package-json" && (
        <EvidenceBanner />
      )}

      {/* Tree sections */}
      <div className="space-y-3">
        {tree.map((section, i) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <ArchitectureNode
              node={section}
              depth={0}
              defaultExpanded
              onSelectDomain={onSelectDomain}
              selectedPrefix={selectedPrefix}
            />
          </motion.div>
        ))}
      </div>

      {/* Footer */}
      {state.generatedAt && (
        <TreeFooter
          generatedAt={state.generatedAt}
          systemSource={systemSource}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function SkeletonSection({ label, rows }: { label: string; rows: number }) {
  return (
    <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/[0.06]" />
        <div className="h-4 w-36 animate-pulse rounded bg-white/[0.06]" />
      </div>
      <div className="ml-6 space-y-2 pt-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-xl px-3 py-2"
          >
            <div
              className="h-3 animate-pulse rounded bg-white/[0.05]"
              style={{ width: `${55 + (i % 3) * 15}%`, animationDelay: `${i * 100}ms` }}
            />
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function PartialBanner({
  hasDomains,
  hasSystems,
}: {
  hasDomains: boolean;
  hasSystems: boolean;
}) {
  const message = !hasDomains
    ? "Directory structure unavailable — tree fetch may have timed out."
    : !hasSystems
    ? "No package.json detected — system analysis unavailable for this repo."
    : "Partial data — some sections could not be loaded.";

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <p className="text-xs text-amber-300/80">{message}</p>
    </div>
  );
}

function EvidenceBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/10 bg-blue-500/5 px-4 py-3">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
      <p className="text-xs text-blue-300/70">
        Systems detected from <code className="text-blue-300">package.json</code> only.
        Source files have not been read — systems may be installed but not yet implemented.
      </p>
    </div>
  );
}

function TreeFooter({
  generatedAt,
  systemSource,
}: {
  generatedAt: string;
  systemSource: ArchitectureResponse["systemSource"] | null;
}) {
  const date = new Date(generatedAt);
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex items-center gap-3 px-1 pt-2">
      <GitBranch className="h-3 w-3 text-zinc-700" />
      <span className="text-[10px] text-zinc-700">
        Generated {timeStr}
        {systemSource === "package-json+source-evidence"
          ? " · source-confirmed systems"
          : " · package.json signals"}
      </span>
    </div>
  );
}
