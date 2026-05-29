"use client";

/**
 * Architecture Workspace Page
 *
 * Two-column layout:
 *   Left  — Repository Cognition Tree (domains + systems)
 *   Right — Intelligence Panel (findings for the selected domain)
 *
 * The right panel is idle until the user clicks a domain node.
 * Clicking a domain triggers useDomainIntelligence.loadDomain(),
 * which fetches findings from all modules (Cipher, Sentinel, Pulse, Atlas)
 * for files in that domain prefix and renders them in IntelligencePanel.
 *
 * Column widths: 1fr | 380px (collapses to single column below xl breakpoint).
 *
 * Evidence honesty (left column):
 *   - "source-confirmed" (✅) means keywords matched filenames in the tree.
 *     It does NOT mean the implementation is correct or complete.
 *   - "package.json only" (⚠️) means the dependency exists, not that it's used.
 *   - All of this is v1. v2 adds bounded import analysis; v3 adds integrity scoring.
 */

import { Github, RefreshCw, TreePine } from "lucide-react";
import { useRouter }            from "next/navigation";

import { PageHeading }          from "@/components/dashboard/page-heading";
import { useActiveRepository }  from "@/contexts/repository-context";
import { useArchitectureTree }  from "@/hooks/use-architecture-tree";
import { useDomainIntelligence } from "@/hooks/use-domain-intelligence";
import { ArchitectureTree }     from "./components/architecture-tree";
import { IntelligencePanel }    from "./components/intelligence-panel";

export function ArchitectureWorkspacePage() {
  const { activeRepository } = useActiveRepository();
  const architectureState    = useArchitectureTree();
  const { state: intelligenceState, loadDomain } = useDomainIntelligence();
  const router = useRouter();

  const [owner, repoName] = activeRepository
    ? activeRepository.fullName.split("/")
    : [undefined, undefined];

  /** Navigate to V# chat with a pre-filled question about a specific file+finding. */
  function handleAskVHash(message: string) {
    router.push(`/workspace?prefill=${encodeURIComponent(message)}`);
  }

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
        description="A live map of detected structure and systems. Click any domain to view its intelligence findings. Evidence is a signal, not a guarantee."
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

      {/* ── Two-column workspace ──────────────────────────── */}
      {activeRepository && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">

          {/* ── Left: architecture tree ─────────────────────── */}
          <div className="min-w-0 space-y-3">
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
            <ArchitectureTree
              state={architectureState}
              onSelectDomain={loadDomain}
              selectedPrefix={intelligenceState.domainPrefix}
            />

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

          {/* ── Right: intelligence panel ──────────────────── */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] xl:sticky xl:top-6 xl:self-start xl:overflow-y-auto"
               style={{ maxHeight: "calc(100vh - 10rem)" }}>
            <IntelligencePanel
              state={intelligenceState}
              onAskVHash={handleAskVHash}
            />
          </div>

        </div>
      )}
    </div>
  );
}
