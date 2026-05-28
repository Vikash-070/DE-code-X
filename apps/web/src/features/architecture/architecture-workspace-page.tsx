"use client";

/**
 * Architecture Workspace Page
 *
 * Displays the progressive repository cognition tree — a live view of
 * how DE-code X understands the active repository's structure.
 *
 * Two parallel root sections:
 *   1. Structural Domains — directory-level shape (where code lives)
 *   2. Detected Systems  — logical systems (what's installed + confirmed)
 *
 * These are intentionally separate. Mixing structural evidence with logical
 * evidence creates false authority claims ("your auth layer is in src/server/auth"
 * implies correctness we cannot confirm without reading files).
 *
 * Evidence honesty:
 *   - "source-confirmed" (✅) means keywords matched filenames in the tree.
 *     It does NOT mean the implementation is correct or complete.
 *   - "package.json only" (⚠️) means the dependency exists, not that it's used.
 *   - All of this is v1. v2 adds bounded import analysis; v3 adds integrity scoring.
 */

import { Github, RefreshCw, TreePine } from "lucide-react";

import { PageHeading }       from "@/components/dashboard/page-heading";
import { useActiveRepository } from "@/contexts/repository-context";
import { useArchitectureTree } from "@/hooks/use-architecture-tree";
import { ArchitectureTree }  from "./components/architecture-tree";

export function ArchitectureWorkspacePage() {
  const { activeRepository } = useActiveRepository();
  const architectureState    = useArchitectureTree();

  const [owner, repoName] = activeRepository
    ? activeRepository.fullName.split("/")
    : [undefined, undefined];

  return (
    <div className="space-y-8">
      {/* ── Repo badge ────────────────────────────────────── */}
      {activeRepository && (
        <div className="flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400">
          <Github className="h-3 w-3 text-zinc-500" />
          <span className="text-zinc-500">{owner}/</span>
          <span className="text-zinc-300">{repoName}</span>
        </div>
      )}

      {/* ── Heading ───────────────────────────────────────── */}
      <PageHeading
        eyebrow="Architecture Workspace"
        title="How we read your codebase."
        description="A live map of detected structure and systems. Domains show where code lives. Systems show what's installed and confirmed in source. Evidence is a signal, not a guarantee."
      />

      {/* ── No repository selected ────────────────────────── */}
      {!activeRepository && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
          <TreePine className="h-8 w-8 text-zinc-600" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-400">No repository selected</p>
            <p className="text-xs text-zinc-600">
              Select a repository from the top bar to view its architecture map.
            </p>
          </div>
        </div>
      )}

      {/* ── Architecture tree ─────────────────────────────── */}
      {activeRepository && (
        <div className="space-y-3">
          {/* Status row */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <TreePine className="h-4 w-4 text-zinc-600" />
              <span className="text-xs font-medium text-zinc-500">Repository Cognition Tree</span>
            </div>

            {/* Loading spinner */}
            {architectureState.status === "loading" && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-600" />
            )}
          </div>

          {/* Tree */}
          <ArchitectureTree state={architectureState} />

          {/* v1 disclaimer */}
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] px-4 py-3">
            <p className="text-[10px] leading-relaxed text-zinc-700">
              <span className="text-zinc-600">v1 intelligence</span> — structural domains from
              directory layout, systems from package.json + keyword proximity search.
              Source files are not read. Import chains, call graphs, and integrity
              scoring are planned for v2.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
